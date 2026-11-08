import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AppSettingsDto,
  MetadataProviderId,
  MetadataProviderTestResultDto,
  ToolCheckResultDto,
  ToolId,
  ToolPathsStatusDto,
} from '@karaokej/shared';
import { SessionService } from '../session/session.service';
import { SettingsService } from './settings.service';
import { ToolCheckService } from './tool-check.service';
import { ToolPathsStatusService } from './tool-paths-status.service';
import { MetadataProviderTestService } from '../metadata-search/metadata-provider-test.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly session: SessionService,
    private readonly toolPathsStatus: ToolPathsStatusService,
    private readonly toolCheck: ToolCheckService,
    private readonly metadataProviderTest: MetadataProviderTestService,
  ) {}

  @Get()
  get(): AppSettingsDto {
    return this.settings.get();
  }

  @Get('tools')
  toolPaths(): ToolPathsStatusDto {
    return this.toolPathsStatus.status();
  }

  @Post('tools/check')
  async checkTool(@Body() body: { tool: ToolId }): Promise<ToolCheckResultDto> {
    return this.toolCheck.check(body.tool);
  }

  @Post('metadata-providers/:id/test')
  async testMetadataProvider(
    @Param('id') id: MetadataProviderId,
  ): Promise<MetadataProviderTestResultDto> {
    const result = await this.metadataProviderTest.test(id);
    if (result.ok) {
      this.settings.enableMetadataProvider(id);
    }
    this.session.broadcast();
    return result;
  }

  @Patch()
  patch(@Body() body: Partial<AppSettingsDto>): AppSettingsDto {
    const updated = this.settings.patch(body);
    this.session.broadcast();
    return updated;
  }
}
