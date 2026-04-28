@echo off
REM Playable Ads 打包脚本
REM 使用项目配置自动打包

echo ======================================
echo    Playable Ads 渠道包构建
echo ======================================
echo.

node tools/playable/pack-single-html.mjs --blob-compression gzip --use-base64 false --image-format webp --image-quality 30 --image-max-dimension 512

echo.
echo ======================================
echo    构建完成！
echo    输出目录: dist-playable/
echo ======================================
pause
