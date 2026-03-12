import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ==========================================
// 1. 全局中间件：半角标点转全角
// ==========================================
prisma.$use(async (params, next) => {
  // 仅针对 create 和 update 操作
  if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
    const data = params.args.data;
    if (data) {
      const textFields = ['title', 'description', 'outputContent', 'dataFeedback', 'issueLog'];
      
      textFields.forEach(field => {
        if (data[field] && typeof data[field] === 'string') {
          // 执行转换
          data[field] = convertPunctuation(data[field]);
        }
      });
    }
  }
  
  // 继续执行后续操作
  return next(params);
});

/**
 * 标点符号转换工具函数
 */
function convertPunctuation(text: string): string {
  if (!text) return text;
  
  return text
    .replace(/,/g, '，')
    .replace(/\./g, '。')
    .replace(/\?/g, '？')
    .replace(/!/g, '！')
    .replace(/:/g, '：')
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/\[/g, '【')
    .replace(/\]/g, '】');
}

export default prisma;
