import { Injectable, NotFoundException } from '@nestjs/common';
import { calculatePrice, PricingRules } from '@neon-adda/shared';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { StorageService } from '../storage/storage.service';
import { ProductQuery } from './catalog.dto';

const activeInOrder = { where: { isActive: true }, orderBy: { sort: 'asc' as const } };
const listed = { isActive: true, deletedAt: null } satisfies Prisma.ProductWhereInput;

/** How a ready-made design is stored in `products.default_design`. */
interface DefaultDesign {
  lines: { text: string; colorName: string; glowHex: string; tubeHex: string }[];
  fontFamily: string;
  backboardCode: string;
}

interface ProductSpecs {
  sizes?: { label: string; widthIn: number; heightIn: number }[];
  highlights?: string[];
}

type ProductWithCategory = Product & { category: { slug: string; name: string } };

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly storage: StorageService,
  ) {}

  /** Everything the design studio needs to render its pickers, in display order. */
  async studioAssets() {
    const [fonts, colors, backboards, backgrounds, addons, products] = await Promise.all([
      this.prisma.font.findMany(activeInOrder),
      this.prisma.neonColor.findMany(activeInOrder),
      this.prisma.backboard.findMany(activeInOrder),
      this.prisma.background.findMany(activeInOrder),
      this.prisma.addon.findMany(activeInOrder),
      this.prisma.product.findMany({
        where: { ...listed, type: { in: ['TEXT_NEON', 'LOGO_NEON'] } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      fonts: fonts.map(({ id, name, family, styleTag }) => ({ id, name, family, styleTag })),
      colors: colors.map(({ id, name, tubeHex, glowHex, isRgb }) => ({ id, name, tubeHex, glowHex, isRgb })),
      backboards: backboards.map(({ code, name, material, shape }) => ({ code, name, material, shape })),
      backgrounds: backgrounds.map(({ code, name }) => ({ code, name })),
      addons: addons.map(({ code, name, pricingType, value }) => ({
        code,
        name,
        pricingType,
        value: Number(value),
      })),
      products: products.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        type: p.type,
        pricingMode: p.pricingMode,
        minWidthIn: Number(p.minWidthIn),
        maxWidthIn: Number(p.maxWidthIn),
        minHeightIn: Number(p.minHeightIn),
        maxHeightIn: Number(p.maxHeightIn),
      })),
    };
  }

  async categories() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sort: 'asc' },
      select: {
        slug: true,
        name: true,
        seo: true,
        _count: { select: { products: { where: { ...listed, type: 'READYMADE' } } } },
      },
    });
    return categories
      .filter((c) => c._count.products > 0)
      .map(({ _count, seo, ...category }) => ({
        ...category,
        description: (seo as { description?: string } | null)?.description ?? null,
        products: _count.products,
      }));
  }

  async products(query: ProductQuery) {
    const rules = await this.pricing.currentRules();
    const products = await this.prisma.product.findMany({
      where: {
        ...listed,
        type: 'READYMADE',
        ...(query.category ? { category: { slug: query.category, isActive: true } } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { description: { contains: query.q, mode: 'insensitive' } },
                { tags: { has: query.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: { category: { select: { slug: true, name: true } } },
      orderBy: query.sort === 'new' ? { createdAt: 'desc' } : [{ isFeatured: 'desc' }, { createdAt: 'asc' }],
      take: 60,
    });

    const cards = products.map((product) => this.toCard(product, rules));
    if (query.sort === 'price-asc') cards.sort((a, b) => (a.fromPricePaise ?? 0) - (b.fromPricePaise ?? 0));
    if (query.sort === 'price-desc') cards.sort((a, b) => (b.fromPricePaise ?? 0) - (a.fromPricePaise ?? 0));
    return cards;
  }

  async product(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { ...listed, slug, type: 'READYMADE' },
      include: { category: { select: { slug: true, name: true } } },
    });
    if (!product)
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', title: 'This sign is no longer available' });

    const [rules, backboards, related] = await Promise.all([
      this.pricing.currentRules(),
      this.prisma.backboard.findMany({
        ...activeInOrder,
        select: { code: true, name: true, material: true },
      }),
      this.prisma.product.findMany({
        where: { ...listed, type: 'READYMADE', categoryId: product.categoryId, id: { not: product.id } },
        include: { category: { select: { slug: true, name: true } } },
        take: 4,
      }),
    ]);
    const priced = new Set(
      rules.rates.filter((r) => r.productType === product.type).map((r) => r.backboardCode),
    );
    const specs = (product.specs ?? {}) as ProductSpecs;

    return {
      ...this.toCard(product, rules),
      id: product.id,
      description: product.description,
      highlights: specs.highlights ?? [],
      sizes: this.sizesOf(product),
      backboards: backboards.filter((b) => priced.has(b.code)),
      leadTimeDays: product.leadTimeDays,
      // The storefront prices sizes itself, so it needs the same rate the API will charge.
      rateOverridePaise: product.rateOverride ? Math.round(Number(product.rateOverride) * 100) : null,
      related: related.map((p) => this.toCard(p, rules)),
    };
  }

  private toCard(product: ProductWithCategory, rules: PricingRules) {
    const design = product.defaultDesign as unknown as DefaultDesign | null;
    const prices = design
      ? this.sizesOf(product).map((size) =>
          calculatePrice(
            {
              productType: product.type,
              backboardCode: design.backboardCode,
              widthIn: size.widthIn,
              heightIn: size.heightIn,
              colorCount: new Set(design.lines.map((line) => line.glowHex)).size,
              addonCodes: [],
              qty: 1,
              installation: false,
              rateOverridePaise: product.rateOverride ? Math.round(Number(product.rateOverride) * 100) : null,
            },
            rules,
          ),
        )
      : [];
    // "From" is the smallest size a customer can actually order on its own, not one below the minimum.
    const price =
      prices.find((p) => p.status === 'OK' && !p.warnings.includes('BELOW_MIN_ORDER_VALUE')) ??
      prices.find((p) => p.status === 'OK') ??
      null;
    const images = (product.images ?? []) as string[];

    return {
      slug: product.slug,
      name: product.name,
      category: product.category,
      tags: product.tags,
      isFeatured: product.isFeatured,
      design,
      imageUrl: images[0] ? this.storage.url(images[0]) : null,
      fromPricePaise: price?.status === 'OK' ? price.payablePaise : null,
    };
  }

  private sizesOf(product: Product) {
    const sizes = ((product.specs ?? {}) as ProductSpecs).sizes ?? [];
    return [...sizes].sort((a, b) => a.widthIn - b.widthIn);
  }
}
