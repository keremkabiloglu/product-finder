import { VertexAI } from '@google-cloud/vertexai';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { google } from 'googleapis';
import * as randomUseragent from 'random-useragent';
import { Observable, lastValueFrom } from 'rxjs';
import { GetUrlsRequestDto } from './dtos/get.urls.request.dto';
import { GetUrlsResponseDto } from './dtos/get.urls.response.dto';

import * as xpath from 'xpath-html';

@Injectable()
export class AppService {
  private vertexAI: VertexAI;
  private MAX_RETRY_COUNT: number = 3;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getUrls(
    getUrlsRequestDto: GetUrlsRequestDto,
  ): Promise<GetUrlsResponseDto> {
    let attributeUrl: string = null;
    let marketPriceUrl: string = null;
    let marketPrice: number = null;

    const brandModel = await this.getProductBrandAndModel(getUrlsRequestDto);
    if (brandModel) {
      const epeyLinks = await this.getGoogleSearchResults(
        `${brandModel.brand} ${brandModel.model} epey`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const akakceLinks = await this.getGoogleSearchResults(
        `${brandModel.brand} ${brandModel.model} akakce`,
      );
      const links = [...epeyLinks, ...akakceLinks];

      attributeUrl = links.find((link) => link.includes('epey.com'));
      marketPriceUrl = links.find(
        (link) => link.includes('akakce.com') && link.includes('fiyati'),
      );

      if (!attributeUrl) {
        for (let index = 0; index < this.MAX_RETRY_COUNT; index++) {
          if (attributeUrl) {
            break;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const epeyLinks = await this.getGoogleSearchResults(
              `${brandModel.brand} ${brandModel.model} epey`,
            );
            attributeUrl = epeyLinks.find((link) => link.includes('epey.com'));
          }
        }
      }

      if (!marketPriceUrl) {
        for (let index = 0; index < this.MAX_RETRY_COUNT; index++) {
          if (marketPriceUrl) {
            break;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const akakceLinks = await this.getGoogleSearchResults(
              `${brandModel.brand} ${brandModel.model} akakce`,
            );
            marketPriceUrl = akakceLinks.find(
              (link) => link.includes('akakce.com') && link.includes('fiyati'),
            );
          }
        }
      }

      if (marketPriceUrl) {
        marketPrice = await this.getMarketPrice(marketPriceUrl);
      }

      return new GetUrlsResponseDto({
        brand: brandModel.brand,
        model: brandModel.model,
        attributeUrl: attributeUrl ?? null,
        marketPriceUrl: marketPriceUrl ?? null,
        marketPrice: marketPrice,
      });
    }

    return new GetUrlsResponseDto({});
  }

  private generateRandomString(length: number): string {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters.charAt(randomIndex);
    }
    return result;
  }

  private async getGoogleSearchResults(query: string): Promise<string[]> {
    const resultLinks = [];
    const parameters = {
      q: encodeURIComponent(query.replaceAll(' ', '+')),
      oq: encodeURIComponent(query.replaceAll(' ', '+')),
      sca_esv: '596828094',
      rlz: '1C5CHFA_enTR1083TR1083',
      sxsrf: 'ACQVn0_iTuo23PbxyNLbyKnQOtXWfLjYlg%3A1704791251151',
      ei: this.generateRandomString(12),
      ved: this.generateRandomString(
        '0ahUKEwi4oMOn-s-DAxWDVvEDHVpHB4EQ4dUDCBA'.length,
      ),
      uact: '0',

      sclient: 'gws-wiz-serp',
    };

    let parameterString = '';
    for (const key in parameters) {
      if (Object.prototype.hasOwnProperty.call(parameters, key)) {
        const element = parameters[key];
        if (parameterString === '') {
          parameterString += '?';
        } else {
          parameterString += '&';
        }
        parameterString += `${key}=${element}`;
      }
    }
    let result: Observable<AxiosResponse<any, any>>;

    try {
      result = this.httpService.get(
        `https://www.google.com/search?q=${parameterString}`,
        {
          headers: {
            Accept: 'text/html',
            'Content-Type': 'text/html; charset=UTF-8',
            'Cache-Control': 'no-cache',
            'User-Agent': randomUseragent.getRandom(),
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
          },
        },
      );
    } catch (error) {
      Logger.error(error);
      return resultLinks;
    }

    const res = await lastValueFrom(result);
    const nodes = xpath.fromPageSource(res.data).findElements('//a');
    nodes.forEach((node: any) => {
      const href = `${node.getAttribute('href')}`;
      if (href.includes('/url?q=')) {
        const urlSearchParams = new URLSearchParams(href);
        const params = Object.fromEntries(urlSearchParams.entries());
        resultLinks.push(params['/url?q']);
      }
    });

    return resultLinks.filter((link) => link.includes('.html'));
  }

  private async getProductBrandAndModel(
    getUrlsRequestDto: GetUrlsRequestDto,
  ): Promise<any> {
    const similarProducts = [];
    const answer = await this.askVertexAI(
      `${getUrlsRequestDto.productName} bu ürünün marka ve modelini {'brand':'X','model':'X'} JSON formatında söyler misin?`,
    );
    if (answer !== '') {
      try {
        const brandModel = JSON.parse(
          answer
            .replaceAll('`', '')
            .replaceAll("'", '"')
            .replaceAll('JSON', '')
            .replaceAll('json', ''),
        );
        return brandModel;
      } catch (error) {
        Logger.error(answer);
        Logger.error(error);
        return undefined;
      }
    }

    return similarProducts;
  }

  private async initVertex() {
    if (this.vertexAI === undefined) {
      const auth = new google.auth.GoogleAuth({
        keyFile: 'service-account.json',
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const projectId = await auth.getProjectId();
      const vertexAI = new VertexAI({
        project: projectId,
        location: 'us-central1',
        googleAuthOptions: {
          authClient: client as any,
        },
      });
      this.vertexAI = vertexAI;
    }
  }

  private async askVertexAI(question: string): Promise<string> {
    try {
      await this.initVertex();
      const geminiModel = this.vertexAI.preview.getGenerativeModel({
        model: 'gemini-pro',
      });

      const responseStream = await geminiModel.generateContentStream({
        contents: [
          {
            parts: [
              {
                text: question,
              },
            ],
            role: 'user',
          },
        ],
      });

      const result = await responseStream.response;
      return result.candidates[0].content.parts[0].text;
    } catch (error) {
      Logger.error(error);
      return '';
    }
  }

  private async getMarketPrice(url: string): Promise<number | null> {
    let lowPrice: number = null;
    try {
      const result = this.httpService.get(url, {
        headers: {
          Accept: 'text/html',
          'Content-Type': 'text/html; charset=UTF-8',
          'Cache-Control': 'no-cache',
          'User-Agent': randomUseragent.getRandom(),
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
        },
      });

      const res = await lastValueFrom(result);
      if (res.data) {
        const nodes = xpath
          .fromPageSource(res.data)
          .findElements("//script[@type='application/ld+json']");

        nodes.forEach((node: any) => {
          const text = node.getText();
          if (text.includes('schema.org')) {
            const json = JSON.parse(text);
            const offerLowPrice = parseFloat(`${json.offers?.lowPrice}`);
            if (!Number.isNaN(offerLowPrice)) {
              if (lowPrice === null) {
                lowPrice = offerLowPrice;
              }
            }
          }
        });
      }
      return lowPrice;
    } catch (error) {
      Logger.error(error);
      return null;
    }
  }
}
