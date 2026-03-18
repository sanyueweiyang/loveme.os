import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 临时数据库调试脚本（运行：npx tsx debug_db.ts）
 *
 * 说明：
 * - 项目的 Prisma schema 在 server/ 下，SQLite URL 也是相对 server/ 的路径。
 * - 这里先 chdir 到 server/，再使用 server/node_modules 中生成的 PrismaClient，避免路径/模型不一致。
 */
async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const serverDir = path.join(__dirname, 'server');
  process.chdir(serverDir);

  // 使用 server/ 目录下的 Prisma Client（与 server/prisma/schema.prisma 对齐）
  const { PrismaClient } = await import('./server/node_modules/@prisma/client');
  const prisma = new PrismaClient();

  async function check() {
    console.log('cwd =', process.cwd());

    // 兼容：当前项目实际表名为 nodeAssignment（NodeAssignment 模型）
    const nodeAssignments = await (prisma as any).nodeAssignment.findMany();

    console.log('=== 数据库 assignments(=nodeAssignment) 表实时数据 ===');
    if (!nodeAssignments || nodeAssignments.length === 0) {
      console.log('结果：表是空的，没有任何数据入库！');
    } else {
      console.table(
        nodeAssignments.map((a: any) => ({
          id: a.id,
          title: a.title ?? null, // 当前 NodeAssignment 不存 title（应为 null）
          node_id: a.nodeId ?? a.node_id ?? null,
          monthCode: a.monthCode ?? a.month_code ?? null,
          plannedIncrement: a.plannedIncrement ?? a.planned_increment ?? null,
          status: a.status ?? null,
        }))
      );
    }

    // 兼容：如果历史上存在 assignment 模型，也尝试读取（不影响主结论）
    try {
      const legacy = await (prisma as any).assignment?.findMany?.();
      if (Array.isArray(legacy)) {
        console.log('=== 数据库 legacy assignment 表实时数据 ===');
        console.log('legacy count =', legacy.length);
      }
    } catch (e: any) {
      // ignore
    }

    // 你关心的三个问题的直接结论（基于 nodeAssignments）
    console.log('\n=== 结论 ===');
    console.log('表里到底有没有数据？', nodeAssignments.length > 0 ? `有（${nodeAssignments.length} 条）` : '没有（0 条）');
    if (nodeAssignments.length > 0) {
      const anyNullNodeId = nodeAssignments.some((a: any) => a.nodeId == null && a.node_id == null);
      console.log('如果有，node_id 是不是 null？', anyNullNodeId ? '存在 node_id 为空的记录' : '全部 node_id 非空');
      const nonNumericId = nodeAssignments.some((a: any) => typeof a.id !== 'number');
      console.log('id 是数字还是 UUID？', nonNumericId ? '存在非数字 id（疑似 UUID/字符串）' : '全部为数字 id（如 1,2,3）');
    }
  }

  await check().catch(console.error).finally(() => prisma.$disconnect());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

