import { Module } from '@nestjs/common';

import { PageRepository } from './page.repository.js';
import { PageTreeService } from './page-tree.service.js';
import { PagesController } from './pages.controller.js';
import { PermissionRepository } from './permission.repository.js';
import { PermissionService } from './permission.service.js';

@Module({
  controllers: [PagesController],
  providers: [PageTreeService, PageRepository, PermissionService, PermissionRepository],
  exports: [PageRepository, PermissionService],
})
export class PagesModule {}
