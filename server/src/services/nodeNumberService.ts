import prisma from '../lib/prisma';

// ==========================================
// 7层 WBS 编码生成服务
// 规则：
// L1: F[Code]
// L2: L1 + O[Code]
// L3: L2 + KR[Code]
// L4: L3 + D1[Code]
// L5: L4 + D2[Code]
// L6: L5 + M[Code]
// L7: L6 + W[Code]
// ==========================================

export const LEVEL_PREFIX_MAP: Record<number, string> = {
    1: 'F',   // Category
    2: 'O',   // Objective
    3: 'KR',  // Key Result
    4: 'D1',  // Detail 1
    5: 'D2',  // Detail 2
    6: 'M',   // Month
    7: 'W'    // Week (Execution Layer)
};

export const CATEGORY_MAP: Record<string, string> = {
    '工作': '01',
    '生活': '02',
    '学习': '03',
    '其他': '99',
    'WORK': '01',   // Backward compatibility
    'LIFE': '02',   // Backward compatibility
    'STUDY': '03',  // Backward compatibility
    'OTHER': '99'   // Backward compatibility
};

/**
 * Generate the next WBS node number
 * [Updated] Execution Layer (L7) uses a separator to distinguish from Planning DNA
 */
export async function generateWBSNodeNumber(category: string, parentId?: number | null, periodType?: string): Promise<string> {
    const categoryCode = CATEGORY_MAP[category.toUpperCase()] || '99';

    // 1. Root Node (Level 1)
    if (!parentId) {
        // L1 Format: F[CategoryCode] (e.g. F01)
        return `F${categoryCode}`;
    }

    // 2. Child Node (Level > 1)
    const parent = await prisma.planNode.findUnique({
        where: { id: parentId },
        select: { nodeNumber: true, level: true }
    });

    if (!parent || !parent.nodeNumber) {
        throw new Error('Parent node number is missing');
    }

    const currentLevel = parent.level + 1;
    let typePrefix = LEVEL_PREFIX_MAP[currentLevel];
    
    // [New] Execution Layer Handling (Level 7)
    // If it's L7, check periodType for specific prefix (W for Week, H for Half-Month)
    if (currentLevel === 7) {
        if (periodType === 'HALF_MONTH') {
            typePrefix = 'H';
        } else {
            typePrefix = 'W';
        }
    }
    
    if (!typePrefix) {
        throw new Error(`Unsupported level: ${currentLevel}`);
    }

    // [New] Execution Layer Separator Logic
    // L1-L6: Strict Concatenation (F01O01)
    // L7: Separated Suffix (F01O01...M01-W01)
    const separator = currentLevel === 7 ? '-' : '';
    const searchPrefix = `${parent.nodeNumber}${separator}${typePrefix}`;

    // Find last child with this prefix
    const lastChild = await prisma.planNode.findFirst({
        where: {
            parentId: parentId,
            nodeNumber: {
                startsWith: searchPrefix
            }
        },
        orderBy: {
            nodeNumber: 'desc'
        },
        select: { nodeNumber: true }
    });

    let nextSeq = 1;
    if (lastChild && lastChild.nodeNumber) {
        // Extract sequence: last 2 digits
        // e.g. ...M01-W01 -> 01
        const suffix = lastChild.nodeNumber.slice(searchPrefix.length);
        if (suffix.length >= 2) {
             const seqStr = suffix.substring(0, 2);
             const currentSeq = parseInt(seqStr);
             if (!isNaN(currentSeq)) {
                 nextSeq = currentSeq + 1;
             }
        }
    }

    const seqStr = nextSeq.toString().padStart(2, '0');
    return `${searchPrefix}${seqStr}`;
}

/**
 * Extract Code Components from Node Number
 * e.g. F01O01 -> { planCategoryCode: '01', objectiveCode: '01' }
 * [Updated] Supports Execution Layer Suffix (-W01)
 */
export function extractWBSCodes(nodeNumber: string) {
    // Regex parsing based on known prefixes
    // F(\d{2}) (O(\d{2}))? (KR(\d{2}))? (D1(\d{2}))? (D2(\d{2}))? (M(\d{2}))? (-W(\d{2})|-H(\d{2}))?
    
    const codes: any = {};
    
    const fMatch = nodeNumber.match(/F(\d{2})/);
    if (fMatch) codes.planCategoryCode = fMatch[1];

    const oMatch = nodeNumber.match(/O(\d{2})/);
    if (oMatch) codes.objectiveCode = oMatch[1];

    const krMatch = nodeNumber.match(/KR(\d{2})/);
    if (krMatch) codes.krCode = krMatch[1];

    const d1Match = nodeNumber.match(/D1(\d{2})/);
    if (d1Match) codes.detail1Code = d1Match[1];

    const d2Match = nodeNumber.match(/D2(\d{2})/);
    if (d2Match) codes.detail2Code = d2Match[1];

    const mMatch = nodeNumber.match(/M(\d{2})/);
    if (mMatch) codes.monthCode = mMatch[1];

    // Execution Layer: Handle separator
    const wMatch = nodeNumber.match(/-W(\d{2})/);
    if (wMatch) codes.weekCode = wMatch[1];
    
    // Optional: Handle Half-Month if we add a code for it? 
    // Schema doesn't have halfMonthCode. reusing weekCode or ignore?
    // User said "Week Code" in schema. Let's just map W to weekCode.
    
    return codes;
}
