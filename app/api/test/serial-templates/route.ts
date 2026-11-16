/** 串口解析模板 API - 列表 / 新建 / 更新 / 删除 / 试解析
 *
 * 模板是一段 TypeScript 代码（契约见 src/utils/serialCodeTemplates.builtin.ts）。
 * 保存时在服务端沙箱编译一次以校验语法与契约；试解析同样在服务端执行
 * （客户端已剥离 Node API，无法安全运行模板代码）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildTemplateSnapshot, testTemplate } from '../../../../src/server/serialTemplateCompiler';
import {
  createUserSerialTemplate,
  deleteUserSerialTemplate,
  loadAllSerialTemplates,
  updateUserSerialTemplate,
} from '../../../../src/server/storage/serialTemplateStore';

/** GET /api/test/serial-templates - 全部可用模板（内置 + 用户） */
export async function GET() {
  return NextResponse.json({ success: true, templates: loadAllSerialTemplates() });
}

/** POST /api/test/serial-templates
 *  body: { code, name? }               新建模板
 *  body: { action: 'test', code, sample } 试解析（不落库）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body?.action === 'test') {
      const kind = body.kind === 'dsl' ? 'dsl' : 'code';
      const sample = typeof body.sample === 'string' ? body.sample : '';
      let snapshot;
      try {
        snapshot = buildTemplateSnapshot(
          kind,
          kind === 'dsl' ? { dsl: body.dsl } : { code: typeof body.code === 'string' ? body.code : '' }
        );
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const outcome = testTemplate(snapshot, sample);
        return NextResponse.json({ success: true, snapshot, ...outcome });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: err instanceof Error ? err.message : String(err),
          meta: snapshot.meta,
        });
      }
    }

    const kind = body?.kind === 'dsl' ? 'dsl' : 'code';
    const payload = {
      kind,
      code: typeof body?.code === 'string' ? body.code : undefined,
      dsl: body?.dsl,
    } as const;
    const result = createUserSerialTemplate(payload, typeof body?.name === 'string' ? body.name : undefined);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.errors.join('；'), errors: result.errors }, { status: 400 });
    }
    return NextResponse.json({ success: true, template: result.record });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** PUT /api/test/serial-templates - 更新用户模板  body: { id, code, name? } */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = typeof body?.id === 'string' ? body.id : '';
    const kind = body?.kind === 'dsl' ? 'dsl' : 'code';
    const payload = {
      kind,
      code: typeof body?.code === 'string' ? body.code : undefined,
      dsl: body?.dsl,
    } as const;
    if (!id || (kind === 'code' ? !payload.code : !payload.dsl)) {
      return NextResponse.json({ success: false, message: '缺少 id 或模板内容' }, { status: 400 });
    }
    const result = updateUserSerialTemplate(id, payload, typeof body?.name === 'string' ? body.name : undefined);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.errors.join('；'), errors: result.errors },
        { status: result.notFound ? 404 : 400 }
      );
    }
    return NextResponse.json({ success: true, template: result.record });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/** DELETE /api/test/serial-templates?id=xxx */
export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, message: '缺少 id' }, { status: 400 });
  }
  if (!deleteUserSerialTemplate(id)) {
    return NextResponse.json({ success: false, message: '模板不存在或为内置模板' }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}
