import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { areaHundredths, LineInput } from '@neon-adda/shared';
import { Design, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { PricedProduct, PricingRepository } from '../pricing/pricing.repository';
import { decodeImageDataUrl, StorageService } from '../storage/storage.service';
import { colorCountOf, DesignConfig, DesignInput, describeDesign } from './design.dto';

export interface ResolvedDesign {
  design: DesignInput;
  product: PricedProduct;
  backboardName: string;
  line: LineInput;
  description: string;
}

/** What is kept in `designs.config`: the studio config plus the choices that have no column. */
type StoredConfig = DesignConfig & { backboardCode: string; addonCodes: string[]; name?: string };

type Db = Prisma.TransactionClient | PrismaService;

const SLUG_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class DesignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingRepository,
    private readonly storage: StorageService,
  ) {}

  /** Checks every design against the live catalogue and turns it into a pricing line. */
  async resolve(items: { design: DesignInput; qty: number }[]): Promise<ResolvedDesign[]> {
    const productIds = [...new Set(items.map((item) => item.design.productId))];
    const backboardCodes = [...new Set(items.map((item) => item.design.backboardCode))];

    const [products, backboards] = await Promise.all([
      Promise.all(productIds.map((id) => this.pricing.product(id))),
      this.prisma.backboard.findMany({
        where: { code: { in: backboardCodes }, isActive: true },
        select: { code: true, name: true },
      }),
    ]);
    const productById = new Map(products.filter((p) => p !== null).map((p) => [p.id, p]));
    const boardName = new Map(backboards.map((b) => [b.code, b.name]));

    return items.map(({ design, qty }, lineIndex) => {
      const product = productById.get(design.productId);
      if (!product) {
        throw new UnprocessableEntityException({
          code: 'PRODUCT_UNAVAILABLE',
          title: 'A sign in your cart is no longer available',
          lineIndex,
        });
      }
      const backboardName = boardName.get(design.backboardCode);
      if (!backboardName) {
        throw new UnprocessableEntityException({
          code: 'BACKBOARD_UNAVAILABLE',
          title: 'A backboard in your cart is no longer available',
          lineIndex,
        });
      }

      return {
        design,
        product,
        backboardName,
        description: describeDesign(design, backboardName),
        line: {
          productType: product.type,
          backboardCode: design.backboardCode,
          widthIn: design.widthIn,
          heightIn: design.heightIn,
          colorCount: colorCountOf(design.config),
          addonCodes: design.addonCodes,
          qty,
          sizeLimits: product.sizeLimits,
          rateOverridePaise: product.rateOverridePaise,
        },
      };
    });
  }

  /** Stores a canvas preview. Returns null for anything that is not really an image. */
  async storePreview(dataUrl: string | undefined): Promise<string | null> {
    if (!dataUrl) return null;
    const image = decodeImageDataUrl(dataUrl);
    return image ? this.storage.put('designs', image.body, image.type) : null;
  }

  async assertLogoOwned(userId: string, design: DesignInput) {
    if (design.config.mode !== 'LOGO') return;
    const upload = await this.prisma.upload.findFirst({
      where: { id: design.config.uploadId, ownerUserId: userId, kind: 'LOGO' },
      select: { id: true },
    });
    if (!upload) throw new NotFoundException({ code: 'UPLOAD_NOT_FOUND', title: 'Upload your logo again' });
  }

  create(
    db: Db,
    userId: string,
    design: DesignInput,
    options: { previewKey: string | null; saved: boolean; name?: string },
  ): Promise<Design> {
    const config: StoredConfig = {
      ...design.config,
      backboardCode: design.backboardCode,
      addonCodes: design.addonCodes,
      ...(options.name ? { name: options.name } : {}),
    };
    return db.design.create({
      data: {
        userId,
        productId: design.productId,
        mode: design.config.mode,
        config,
        widthIn: design.widthIn,
        heightIn: design.heightIn,
        areaSqft: areaHundredths(design.widthIn, design.heightIn) / 100,
        previewKey: options.previewKey,
        isSaved: options.saved,
      },
    });
  }

  /** The shape the storefront works with, rebuilt from a stored design. */
  toView(design: Design & { product: { slug: string; name: string; type: string } }) {
    const { backboardCode, addonCodes, name, ...config } = design.config as unknown as StoredConfig;
    return {
      id: design.id,
      name: name ?? (config.mode === 'TEXT' ? config.lines.map((line) => line.text).join(' ') : 'Logo sign'),
      previewUrl: this.storage.url(design.previewKey),
      shareSlug: design.shareSlug,
      product: design.product,
      design: {
        productId: design.productId,
        config: config as DesignConfig,
        widthIn: Number(design.widthIn),
        heightIn: Number(design.heightIn),
        backboardCode,
        addonCodes,
      },
      createdAt: design.createdAt,
    };
  }

  newShareSlug(): string {
    return Array.from(randomBytes(10), (byte) => SLUG_ALPHABET[byte % SLUG_ALPHABET.length]).join('');
  }
}
