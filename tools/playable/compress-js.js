#!/usr/bin/env node

/**
 * JS 代码压缩脚本 - 使用 terser 压缩所有 JavaScript 文件
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const BUILD_DIR = path.join(__dirname, '../../build/web-mobile');
let totalOriginalSize = 0;
let totalMinifiedSize = 0;
let filesProcessed = 0;

async function compressJsFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    const originalSize = code.length;

    // Terser 压缩选项
    const result = await minify(code, {
      compress: {
        drop_console: true,     // 删除 console.log
        drop_debugger: true,    // 删除 debugger
        passes: 2,              // 压缩两遍
        pure_funcs: ['console.log', 'console.warn', 'console.info']
      },
      mangle: {
        toplevel: true,         // 混淆顶级作用域变量
        safari10: true          // 兼容 Safari 10
      },
      format: {
        comments: false         // 删除所有注释
      }
    });

    if (result.code) {
      const minifiedSize = result.code.length;
      const saved = originalSize - minifiedSize;
      const percent = ((saved / originalSize) * 100).toFixed(1);

      fs.writeFileSync(filePath, result.code, 'utf8');

      totalOriginalSize += originalSize;
      totalMinifiedSize += minifiedSize;
      filesProcessed++;

      if (saved > 10240) { // 只显示节省超过 10KB 的文件
        console.log(`   ✓ ${path.relative(BUILD_DIR, filePath)}: ${(originalSize / 1024).toFixed(1)}KB → ${(minifiedSize / 1024).toFixed(1)}KB (节省 ${percent}%)`);
      }
    }
  } catch (error) {
    console.error(`   ✗ 压缩失败: ${path.relative(BUILD_DIR, filePath)}: ${error.message}`);
  }
}

async function compressDirectory(dir, excludePatterns = []) {
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    // 检查是否应该排除
    const shouldExclude = excludePatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return fullPath.includes(pattern);
      } else if (pattern instanceof RegExp) {
        return pattern.test(fullPath);
      }
      return false;
    });

    if (shouldExclude) continue;

    if (file.isDirectory()) {
      await compressDirectory(fullPath, excludePatterns);
    } else if (file.name.endsWith('.js')) {
      await compressJsFile(fullPath);
    }
  }
}

async function main() {
  console.log('🗜️  开始压缩 JavaScript 代码...\n');
  console.log('目标目录:', BUILD_DIR);
  console.log('='.repeat(60));

  // 排除一些不需要压缩的文件（已经压缩过的）
  const excludePatterns = [
    /\.min\.js$/,
    /\.bundle\.js$/
  ];

  await compressDirectory(BUILD_DIR, excludePatterns);

  console.log('='.repeat(60));
  console.log(`✅ 压缩完成！`);
  console.log(`   处理文件: ${filesProcessed} 个`);
  console.log(`   原始大小: ${(totalOriginalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   压缩后: ${(totalMinifiedSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   节省空间: ${((totalOriginalSize - totalMinifiedSize) / 1024 / 1024).toFixed(2)} MB (${((1 - totalMinifiedSize / totalOriginalSize) * 100).toFixed(1)}%)`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('压缩失败:', err);
  process.exit(1);
});
