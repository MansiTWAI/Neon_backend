import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { pageOf, skipTake } from '../../../common/http/pagination';
import { Meta, type RequestMeta } from '../../../common/http/request-meta';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { Authenticated, CurrentAuth, RequirePermissions } from '../../auth/auth.decorators';
import { AccessClaims } from '../../auth/auth.types';
import { translateUnique } from '../pricing/admin-pricing.service';
import {
  CategoryDto,
  categorySchema,
  ProductDto,
  ProductListQuery,
  productListSchema,
  productSchema,
} from './admin-catalog.dto';

const id = new ParseUUIDPipe();

@Controller('admin/catalog')
@Authenticated(['admin'])
export class AdminCatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('categories')
  @RequirePermissions('orders.read')
  async categories() {
    const categories = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { sort: 'asc' },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    });
    return categories.map(({ _count, seo, ...category }) => ({
      ...category,
      description: (seo as { description?: string } | null)?.description ?? null,
      products: _count.products,
    }));
  }

  @Post('categories')
  @RequirePermissions('catalog.write')
  createCategory(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(categorySchema)) dto: CategoryDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.saveCategory(auth.sub, null, dto, meta);
  }

  @Put('categories/:id')
  @RequirePermissions('catalog.write')
  updateCategory(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) categoryId: string,
    @Body(new ZodValidationPipe(categorySchema)) dto: CategoryDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.saveCategory(auth.sub, categoryId, dto, meta);
  }

  @Get('products')
  @RequirePermissions('orders.read')
  async products(@Query(new ZodValidationPipe(productListSchema)) query: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q.toLowerCase() } },
              { tags: { has: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        ...skipTake(query),
        include: { category: { select: { name: true } }, _count: { select: { orderItems: true } } },
      }),
      this.prisma.product.count({ where }),
    ]);
    return pageOf(
      products.map(({ _count, category, ...product }) => ({
        ...this.toView(product),
        category: category.name,
        timesOrdered: _count.orderItems,
      })),
      total,
      query,
    );
  }

  @Get('products/:id')
  @RequirePermissions('orders.read')
  async product(@Param('id', id) productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', title: 'Product not found' });
    return this.toView(product);
  }

  @Post('products')
  @RequirePermissions('catalog.write')
  createProduct(
    @CurrentAuth() auth: AccessClaims,
    @Body(new ZodValidationPipe(productSchema)) dto: ProductDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.saveProduct(auth.sub, null, dto, meta);
  }

  @Put('products/:id')
  @RequirePermissions('catalog.write')
  updateProduct(
    @CurrentAuth() auth: AccessClaims,
    @Param('id', id) productId: string,
    @Body(new ZodValidationPipe(productSchema)) dto: ProductDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.saveProduct(auth.sub, productId, dto, meta);
  }

  private async saveCategory(
    actorId: string,
    categoryId: string | null,
    dto: CategoryDto,
    meta: RequestMeta,
  ) {
    const { description, ...fields } = dto;
    const data = { ...fields, seo: { description } };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = categoryId
          ? await tx.category.update({ where: { id: categoryId }, data })
          : await tx.category.create({ data });
        await this.audit.record(
          {
            actorId,
            action: categoryId ? 'category.updated' : 'category.created',
            entity: 'category',
            entityId: category.id,
            after: dto,
            ...meta,
          },
          tx,
        );
        return { ...category, description };
      });
    } catch (error) {
      throw translateUnique(error, 'Another category already uses this web address');
    }
  }

  private async saveProduct(actorId: string, productId: string | null, dto: ProductDto, meta: RequestMeta) {
    const sizes = [...dto.sizes].sort((a, b) => a.widthIn - b.widthIn);
    const data: Prisma.ProductUncheckedCreateInput = {
      categoryId: dto.categoryId,
      type: dto.type,
      pricingMode: dto.pricingMode,
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      defaultDesign: dto.design ?? Prisma.JsonNull,
      specs: { sizes, highlights: dto.highlights },
      tags: dto.tags,
      leadTimeDays: dto.leadTimeDays,
      rateOverride: dto.rateOverridePaise === null ? null : dto.rateOverridePaise / 100,
      isFeatured: dto.isFeatured,
      isActive: dto.isActive,
      ...(sizes.length ? { minWidthIn: sizes[0]!.widthIn, maxWidthIn: sizes.at(-1)!.widthIn } : {}),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = productId
          ? await tx.product.update({ where: { id: productId }, data })
          : await tx.product.create({ data });
        await this.audit.record(
          {
            actorId,
            action: productId ? 'product.updated' : 'product.created',
            entity: 'product',
            entityId: product.id,
            after: dto,
            ...meta,
          },
          tx,
        );
        return this.toView(product);
      });
    } catch (error) {
      throw translateUnique(error, 'Another product already uses this web address');
    }
  }

  private toView(product: Product) {
    const specs = (product.specs ?? {}) as { sizes?: unknown[]; highlights?: string[] };
    return {
      id: product.id,
      categoryId: product.categoryId,
      type: product.type,
      pricingMode: product.pricingMode,
      name: product.name,
      slug: product.slug,
      description: product.description,
      design: product.defaultDesign,
      sizes: specs.sizes ?? [],
      highlights: specs.highlights ?? [],
      tags: product.tags,
      leadTimeDays: product.leadTimeDays,
      rateOverridePaise: product.rateOverride ? Math.round(Number(product.rateOverride) * 100) : null,
      isFeatured: product.isFeatured,
      isActive: product.isActive,
      updatedAt: product.updatedAt,
    };
  }
}
