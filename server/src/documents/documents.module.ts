import { Module } from '@nestjs/common';

import { DocRepository } from './doc.repository.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentService } from './documents.service.js';
import { PagesModule } from '../pages/pages.module.js';

@Module({
  imports: [PagesModule],
  controllers: [DocumentsController],
  providers: [DocumentService, DocRepository],
  exports: [DocRepository],
})
export class DocumentsModule {}
