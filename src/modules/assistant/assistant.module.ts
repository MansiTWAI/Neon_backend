import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ArtworkController } from './artwork.controller';
import { ArtworkService } from './artwork.service';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [CatalogModule],
  controllers: [AssistantController, ArtworkController],
  providers: [AssistantService, ArtworkService],
})
export class AssistantModule {}
