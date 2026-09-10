import { z } from 'zod';

export const fetchUrlInputSchema = z.object({
  url: z.string().describe('要抓取的网页 URL'),
  maxLength: z.number().int().min(100).max(10000).optional().describe('最大返回字符数，默认 4000'),
});

export async function fetchUrlTool({ url, maxLength }: { url: string; maxLength?: number }) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const limit = maxLength ?? 4000;
    return {
      url,
      title: extractTitle(html),
      content: text.slice(0, limit),
      truncated: text.length > limit,
      totalLength: text.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '抓取失败';
    return { error: msg };
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim();
}

export const webSearchInputSchema = z.object({
  query: z.string().describe('搜索关键词'),
  count: z.number().int().min(1).max(10).optional().describe('返回结果数量，默认 5'),
});

export async function webSearchTool({ query, count }: { query: string; count?: number }) {
  const limit = count ?? 5;
  try {
    // DuckDuckGo Lite HTML 搜索
    const params = new URLSearchParams({ q: query, kl: 'zh-cn' });
    const res = await fetch(`https://duckduckgo.com/html/?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { error: `DuckDuckGo 返回 HTTP ${res.status}` };
    }
    const html = await res.text();
    const results = parseDuckDuckGoResults(html, limit);
    return {
      query,
      engine: 'DuckDuckGo',
      results,
      note: 'DuckDuckGo 搜索可能因反爬限制不稳定，可配置 SERPER_API_KEY 使用更稳定的 Serper。',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '搜索失败';
    return { error: msg };
  }
}

function parseDuckDuckGoResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const rowRegex = /<div class="result results_links[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null && results.length < limit) {
    const block = match[0];
    const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const urlMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/i);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch && urlMatch) {
      const title = stripHtml(titleMatch[1]);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
      let url = decodeHtmlEntities(urlMatch[1]);
      if (url.startsWith('//')) url = `https:${url}`;
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'");
}

export const calculateInputSchema = z.object({
  expression: z.string().describe('数学表达式，例如 (100 + 200) / 3'),
});

export function calculateTool({ expression }: { expression: string }) {
  try {
    const sanitized = expression.replace(/[^0-9+\-*/().\s%^\s]/g, '');
    if (!sanitized) {
      return { error: '表达式为空或包含非法字符' };
    }
    // 使用 Function 构造安全沙箱，只返回数值结果
    const fn = new Function(`return (${sanitized})`);
    const result = fn();
    return { expression, result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '计算失败';
    return { error: msg };
  }
}

export const currentTimeInputSchema = z.object({});

export function currentTimeTool() {
  return {
    iso: new Date().toISOString(),
    locale: new Date().toLocaleString('zh-CN'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export const serperSearchInputSchema = z.object({
  query: z.string().describe('搜索关键词'),
  count: z.number().int().min(1).max(10).optional().describe('返回结果数量，默认 5'),
});

export async function serperSearchTool({ query, count }: { query: string; count?: number }) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { error: '未配置 SERPER_API_KEY，请在 .env.local 中添加 SERPER_API_KEY=xxx' };
  }
  const limit = count ?? 5;
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: limit }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return { error: `Serper HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    return {
      query,
      engine: 'Serper (Google)',
      organic: (data.organic || []).slice(0, limit).map((r: any) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Serper 搜索失败';
    return { error: msg };
  }
}
