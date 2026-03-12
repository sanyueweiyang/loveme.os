
import { PrismaClient } from '@prisma/client';
import { generateWBSNodeNumber, extractWBSCodes } from '../src/services/nodeNumberService';

const prisma = new PrismaClient();

async function main() {
    console.log('=== 拼接算法验证 (WBS DNA Compliance) ===');
    
    // 模拟输入: F01/O01/KR01/D101/D201/M03
    // 我们需要模拟一个完整的层级链，因为 generateWBSNodeNumber 依赖于父节点。
    
    // 1. Cleanup
    await prisma.planNode.deleteMany({
        where: {
            OR: [
                { title: { startsWith: '[COMPLIANCE]' } },
                { nodeNumber: { startsWith: 'F01' } } // Aggressive cleanup for test
            ]
        }
    });

    // 2. Build Hierarchy
    // L1: F01
    const l1 = await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] L1',
            level: 1,
            planCategory: 'WORK',
            nodeNumber: 'F01',
            planCategoryCode: '01'
        }
    });

    // L2: F01O01
    const l2 = await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] L2',
            level: 2,
            parentId: l1.id,
            nodeNumber: 'F01O01',
            objectiveCode: '01'
        }
    });

    // L3: F01O01KR01
    const l3 = await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] L3',
            level: 3,
            parentId: l2.id,
            nodeNumber: 'F01O01KR01',
            krCode: '01'
        }
    });

    // L4: F01O01KR01D101
    const l4 = await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] L4',
            level: 4,
            parentId: l3.id,
            nodeNumber: 'F01O01KR01D101',
            detail1Code: '01'
        }
    });

    // L5: F01O01KR01D101D201
    const l5 = await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] L5',
            level: 5,
            parentId: l4.id,
            nodeNumber: 'F01O01KR01D101D201',
            detail2Code: '01'
        }
    });

    // L6: Generate Next Child (Month)
    // Parent: l5 (F01O01KR01D101D201)
    // Expected next: ...M01 (if no existing children)
    
    // Let's create M01 and M02 first to verify M03 generation
    await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] M01',
            level: 6,
            parentId: l5.id,
            nodeNumber: 'F01O01KR01D101D201M01',
            monthCode: '01'
        }
    });
    
    await prisma.planNode.create({
        data: {
            title: '[COMPLIANCE] M02',
            level: 6,
            parentId: l5.id,
            nodeNumber: 'F01O01KR01D101D201M02',
            monthCode: '02'
        }
    });

    // Now generate M03
    const generatedNodeNumber = await generateWBSNodeNumber('WORK', l5.id, 'MONTH');
    
    console.log(`\nInput Scenario:`);
    console.log(`Parent (L5): ${l5.nodeNumber}`);
    console.log(`Existing Children: M01, M02`);
    console.log(`Generated Output: ${generatedNodeNumber}`);
    
    const expected = 'F01O01KR01D101D201M03';
    if (generatedNodeNumber === expected) {
        console.log(`✅ Result: PASS (Matches ${expected})`);
    } else {
        console.error(`❌ Result: FAIL (Expected ${expected}, got ${generatedNodeNumber})`);
    }

    // Cleanup
    await prisma.planNode.deleteMany({
        where: { title: { startsWith: '[COMPLIANCE]' } }
    });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
