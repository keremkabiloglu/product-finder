import { Body, Controller, Post } from '@nestjs/common';
import { AppService } from './app.service';
import { GetUrlsRequestDto } from './dtos/get.urls.request.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('getUrls')
  async getUrls(@Body() getUrlsRequestDto: GetUrlsRequestDto): Promise<any> {
    return await this.appService.getUrls(getUrlsRequestDto);
  }
}
