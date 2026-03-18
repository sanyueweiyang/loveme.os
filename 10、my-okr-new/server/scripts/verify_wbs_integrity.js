"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * 校验全量 PlanNode 的 WBS 基因链完整性
 */
function verifyWBSDataIntegrity() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('--- WBS Data Integrity Check Started ---');
        const allNodes = yield prisma.planNode.findMany({
            include: { parent: true }
        });
        let errors = 0;
        for (const node of allNodes) {
            // 1. 编码格式校验
            if (!node.nodeNumber) {
                console.error(`❌ [Error] Node ID ${node.id} has no nodeNumber.`);
                errors++;
                continue;
            }
            // 2. 层级一致性校验 (Parent-Child Prefix Match)
            if (node.parent) {
                const parentNumber = node.parent.nodeNumber;
                if (parentNumber && !node.nodeNumber.startsWith(parentNumber)) {
                    console.error(`❌ [Error] Node ID ${node.id} (${node.nodeNumber}) does not match parent (${parentNumber}) prefix.`);
                    errors++;
                }
            }
            // 3. 执行层特殊规则校验 (L7 必须带 -W 或 -H)
            if (node.level === 7) {
                if (!node.nodeNumber.includes('-W') && !node.nodeNumber.includes('-H')) {
                    console.error(`❌ [Error] Execution node ID ${node.id} (${node.nodeNumber}) missing separator (-W or -H).`);
                    errors++;
                }
            }
        }
        if (errors === 0) {
            console.log('✅ All nodes verified. WBS DNA chain is intact.');
        }
        else {
            console.log(`⚠️ Check completed with ${errors} error(s).`);
        }
    });
}
verifyWBSDataIntegrity();
