import prisma from "./src/lib/prisma";
import { generateNextNodeNumber } from "./src/utils/wbsHelper";

async function main() {
  console.log("🌱 Seeding WBSNode data...");

  // 1) 顶层 L1 战略层
  let l1 = await prisma.wBSNode.findFirst({
    where: { level: 1, name: "战略层" },
  });

  if (!l1) {
    const siblings = await prisma.wBSNode.findMany({
      where: { level: 1, parentId: null },
      select: { nodeNumber: true },
    });
    const nodeNumber = generateNextNodeNumber(
      1,
      null,
      siblings.map((s) => s.nodeNumber)
    );

    l1 = await prisma.wBSNode.create({
      data: {
        name: "战略层",
        level: 1,
        nodeNumber,
        parentId: null,
      },
    });
  }

  // 2) L4 联调模块（挂在 L1 下面）
  let l4 = await prisma.wBSNode.findFirst({
    where: { level: 4, name: "联调模块" },
  });

  if (!l4) {
    const siblings = await prisma.wBSNode.findMany({
      where: { parentId: l1.id },
      select: { nodeNumber: true },
    });
    const nodeNumber = generateNextNodeNumber(
      4,
      l1.nodeNumber,
      siblings.map((s) => s.nodeNumber)
    );

    l4 = await prisma.wBSNode.create({
      data: {
        name: "联调模块",
        level: 4,
        nodeNumber,
        parentId: l1.id,
      },
    });
  }

  console.log("✅ Seed completed:", {
    l1: { id: l1.id, nodeNumber: l1.nodeNumber, name: l1.name },
    l4: { id: l4.id, nodeNumber: l4.nodeNumber, name: l4.name },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

