"""Build docs/diet/index.html (weight-loss planner) from src/diet.html.

src/diet.html is the page body as published in Claude (no <html>/<head>), so it stays the single source for both.
"""
import pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'src/diet.html').read_text()
head = '''<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2E7A48">
<meta name="description" content="แผนลดน้ำหนัก นับแคล โปรตีน คาร์บ ไขมัน และเป้าออกกำลังกายรายสัปดาห์">
<link rel="manifest" href="manifest.json">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ลดน้ำหนัก">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<script>if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font-size:14px}img{max-width:100%}</style>
'''
i = src.index('<div class="wrap">')
out = head + src[:i] + '</head>\n<body>\n' + src[i:].rstrip() + '\n</body>\n</html>\n'
(root / 'docs/diet').mkdir(exist_ok=True)
(root / 'docs/diet/index.html').write_text(out)
print('built docs/diet/index.html', len(out), 'bytes')
