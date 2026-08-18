import { Module } from '@nestjs/common';

import { WorkspaceRepository } from './workspace.repository.js';
import { CurrentWorkspaceController, WorkspacesController } from './workspaces.controller.js';
import { WorkspaceService } from './workspaces.service.js';

@Module({
  controllers: [WorkspacesController, CurrentWorkspaceController],
  providers: [WorkspaceService, WorkspaceRepository],
  exports: [WorkspaceRepository],
})
export class WorkspacesModule {}
