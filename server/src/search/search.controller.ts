import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SearchService } from './search.service.js';
import { unwrap } from '../common/api-response.js';
import { RequireWorkspace } from '../common/route-metadata.js';

@ApiTags('search')
@Controller('search')
@RequireWorkspace()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'ค้นหาหน้าใน workspace นี้ — PGroonga bigram รองรับภาษาไทย' })
  async run(
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const parsed = limit === undefined ? undefined : Number(limit);

    return unwrap(
      await this.search.run(
        q ?? '',
        status,
        parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
      ),
    );
  }
}
