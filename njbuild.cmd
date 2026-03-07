
@REM bun build --compile --minify --bytecode --outfile nj.exe .\nj.cli.js
bun build --compile --outfile nj.exe .\nj.cli.js
copy /b /y nj.exe c:\apps\nj.exe