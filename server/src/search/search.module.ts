import { Module } from '@nestjs/common';

import { SearchController } from './search.controller.js';
import { SearchRepository } from './search.repository.js';
import { SearchService } from './search.service.js';
import { PagesModule } from '../pages/pages.module.js';

@Module({
  imports: [PagesModule],
  controllers: [SearchController],
  providers: [SearchService, SearchRepository],
})
export class SearchModule {}
