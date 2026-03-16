/**
 * LoveMe OS — WBS 编号生成工具
 *
 * 约定：
 * - 顶层编号：L{level}-{XX}，例如：L4-01, L4-02
 * - 子级编号：在父级编号后追加一段两位序号：L4-02-01, L4-02-02
 * - 同一父节点下的子编号，按已有兄弟中最大的序号 +1 生成。
 *
 * 注意：
 * - 所有 nodeNumber 必须通过本函数生成，前端不得自行拼接。
 */

/**
 * 根据父级编号与已有兄弟节点编号，生成下一个子级 nodeNumber。
 *
 * @param level 当前节点层级（1-7）
 * @param parentNodeNumber 父节点的 nodeNumber；若为 null，表示顶层节点
 * @param existingSiblingNumbers 同一父节点下已存在的 nodeNumber 列表
 */
export function generateNextNodeNumber(
  level: number,
  parentNodeNumber: string | null,
  existingSiblingNumbers: string[],
): string {
  if (level < 1 || level > 7) {
    throw new Error(`Invalid WBS level: ${level}. Must be 1-7.`);
  }

  // 统一过滤出当前父节点下的兄弟编号（防御性：有些调用方可能传了其它层级的编号）
  const siblings = (existingSiblingNumbers || [])
    .filter((n) => typeof n === 'string' && n.trim().length > 0);

  // 从已有编号中提取最后一段的序号（XX），求最大值
  let maxSeq = 0;
  for (const n of siblings) {
    const parts = n.split('-');
    const last = parts[parts.length - 1];
    const num = parseInt(last, 10);
    if (!Number.isNaN(num) && num > maxSeq) {
      maxSeq = num;
    }
  }

  const nextSeq = (maxSeq + 1).toString().padStart(2, '0');

  if (!parentNodeNumber) {
    // 顶层节点：L{level}-{XX}
    return `L${level}-${nextSeq}`;
  }

  // 子节点：在父编号基础上追加一段
  return `${parentNodeNumber}-${nextSeq}`;
}

