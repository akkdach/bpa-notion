import { Module } from '@nestjs/common';

import { ActivityController, PageNotesController } from './collaboration.controller.js';
import { CollaborationRepository } from './collaboration.repository.js';
import { CollaborationService } from './collaboration.service.js';
import { PagesModule } from '../pages/pages.module.js';

@Module({
  imports: [PagesModule],
  controllers: [PageNotesController, ActivityController],
  providers: [CollaborationService, CollaborationRepository],
})
export class CollaborationModule {}
