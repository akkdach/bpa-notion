import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  type AddMemberInput,
  addMemberSchema,
  type CreateWorkspaceInput,
  createWorkspaceSchema,
  type UpdateMemberInput,
  updateMemberSchema,
  type UpdateWorkspaceInput,
  updateWorkspaceSchema,
} from './workspaces.schema.js';
import { WorkspaceService } from './workspaces.service.js';
import { unwrap } from '../common/api-response.js';
import { RequireWorkspace } from '../common/route-metadata.js';
import { zodBody } from '../common/zod-body.pipe.js';

// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️ แยกเป็นสอง controller เพราะ "ขอบเขต" ต่างกัน ไม่ใช่เพราะยาว
//
//     ตัวนี้ทำงานได้โดยยังไม่ต้องเลือก workspace — สร้างใหม่ และดูรายการของฉัน
//     ถ้าใส่ @RequireWorkspace() ครอบทั้งคู่ การสร้าง workspace แรกจะเป็นไป
//     ไม่ได้เลย (ต้องมี workspace ก่อนถึงจะสร้าง workspace ได้)
// ═══════════════════════════════════════════════════════════════════════════
@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get()
  @ApiOperation({ summary: 'workspace ทั้งหมดที่ฉันเป็นสมาชิก' })
  async listMine() {
    return unwrap(await this.workspaces.listMine());
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(zodBody(createWorkspaceSchema)) body: CreateWorkspaceInput) {
    return unwrap(await this.workspaces.create(body));
  }
}

@ApiTags('workspaces')
@Controller('workspaces/current')
@RequireWorkspace()
export class CurrentWorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get()
  async get() {
    return unwrap(await this.workspaces.getCurrent());
  }

  @Patch()
  async update(@Body(zodBody(updateWorkspaceSchema)) body: UpdateWorkspaceInput) {
    return unwrap(await this.workspaces.update(body));
  }

  @Get('members')
  async listMembers() {
    return unwrap(await this.workspaces.listMembers());
  }

  // ⚠️ 200 ไม่ใช่ 201 — client เดิม (web/ และ smoke test) คาดค่านี้อยู่
  @Post('members')
  @HttpCode(HttpStatus.OK)
  async addMember(@Body(zodBody(addMemberSchema)) body: AddMemberInput) {
    return unwrap(await this.workspaces.addMember(body));
  }

  @Patch('members/:userId')
  @HttpCode(HttpStatus.OK)
  async updateMember(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(zodBody(updateMemberSchema)) body: UpdateMemberInput,
  ) {
    return unwrap(await this.workspaces.updateMember(userId, body));
  }

  @Delete('members/:userId')
  @ApiOperation({ summary: 'ถอดสมาชิก — ออกเองได้เสมอ ถอดคนอื่นต้องเป็น owner/admin' })
  async removeMember(@Param('userId', ParseUUIDPipe) userId: string) {
    return unwrap(await this.workspaces.removeMember(userId));
  }
}
