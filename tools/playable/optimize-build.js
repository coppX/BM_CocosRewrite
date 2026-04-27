#!/usr/bin/env node

/**
 * 优化构建产物 - 移除未使用的资源
 * 1. 删除 art.scene 相关文件
 * 2. 删除所有音频文件 (mp3, wav, ogg)
 * 3. 删除未使用的大型资源
 */

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '../../build/web-mobile');
const ASSETS_DIR = path.join(BUILD_DIR, 'assets');

let deletedCount = 0;
let savedBytes = 0;

// 递归删除文件
function deleteFilesByPattern(dir, patterns) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      deleteFilesByPattern(fullPath, patterns);
    } else {
      // 检查文件是否匹配删除模式
      const shouldDelete = patterns.some(pattern => {
        if (typeof pattern === 'string') {
          return file.name.includes(pattern) || fullPath.includes(pattern);
        } else if (pattern instanceof RegExp) {
          return pattern.test(file.name) || pattern.test(fullPath);
        }
        return false;
      });

      if (shouldDelete) {
        const stats = fs.statSync(fullPath);
        savedBytes += stats.size;
        deletedCount++;

        console.log(`🗑️  删除: ${path.relative(BUILD_DIR, fullPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
        fs.unlinkSync(fullPath);
      }
    }
  }
}

console.log('🔍 开始优化构建产物...\n');
console.log('目标目录:', BUILD_DIR);
console.log('='.repeat(60));

// 删除音频文件
console.log('\n📢 删除音频文件 (Playable Ads 不需要音频)...');
deleteFilesByPattern(ASSETS_DIR, [
  /\.mp3$/,
  /\.wav$/,
  /\.ogg$/,
  /\.m4a$/
]);

// 删除 art.scene 相关文件
console.log('\n🎨 删除未使用的 art.scene...');
deleteFilesByPattern(ASSETS_DIR, [
  'art.scene',
  'art@'
]);

// 删除 skyBox 相关文件（天空盒，Playable Ads 不需要）
console.log('\n🌌 删除天空盒资源...');
deleteFilesByPattern(ASSETS_DIR, [
  'skyBox',
  'skybox',
  'SkyBox'
]);

// 删除大型纹理文件 (> 200KB)
console.log('\n🖼️  检查大型图片文件...');
function checkLargeImages(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      checkLargeImages(fullPath);
    } else if (/\.(png|jpg|jpeg)$/i.test(file.name)) {
      const stats = fs.statSync(fullPath);
      if (stats.size > 200 * 1024) { // > 200KB
        console.log(`   ⚠️  大文件: ${path.relative(BUILD_DIR, fullPath)} (${(stats.size / 1024).toFixed(1)} KB)`);
      }
    }
  }
}
checkLargeImages(ASSETS_DIR);

console.log('\n' + '='.repeat(60));
console.log(`✅ 优化完成！`);
console.log(`   删除文件: ${deletedCount} 个`);
console.log(`   节省空间: ${(savedBytes / 1024 / 1024).toFixed(2)} MB`);
console.log('='.repeat(60));
