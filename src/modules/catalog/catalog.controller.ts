import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ProductQuery, productQuerySchema, productSlugSchema } from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('studio/assets')
  studioAssets() {
    return this.catalog.studioAssets();
  }

  @Get('catalog/categories')
  categories() {
    return this.catalog.categories();
  }

  @Get('catalog/products')
  products(@Query(new ZodValidationPipe(productQuerySchema)) query: ProductQuery) {
    return this.catalog.products(query);
  }

  @Get('catalog/products/:slug')
  product(@Param('slug', new ZodValidationPipe(productSlugSchema)) slug: string) {
    return this.catalog.product(slug);
  }
}
