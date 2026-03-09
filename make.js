import path from 'path';
import { mkdirSync, existsSync, statSync, unlinkSync, readdirSync, rmdirSync } from 'fs';
import { Glob } from "bun";

function needsRecompile(srcPath, objPath) {
    if (!existsSync(objPath)) {
        return true;
    }
    const srcStat = statSync(srcPath);
    const objStat = statSync(objPath);
    return srcStat.mtimeMs > objStat.mtimeMs;
}

/**
 * Build a file list under the specified directory using glob patterns
 * @param {string|string[]} patterns - Glob pattern or array of patterns.
 *                           Format: "include_pattern|exclude_pattern1|exclude_pattern2|..."
 *                           Example: "src/*.cc|browse.cc|*posix.cc|*test.cc"
 *                           Or array: ["src/*.cc|*test.cc", "lib/*.c"]
 * @param {object} options - Options
 * @param {string} options.cwd - Root directory for searching, defaults to current working directory
 * @param {boolean} options.recursive - Whether to search subdirectories recursively, defaults to false
 * @returns {string[]} List of matched file paths
 */
export function file_list(patterns, options = {}) {
    const { cwd = '.', recursive = false } = options;

    // Support both single pattern and array of patterns
    const patternList = Array.isArray(patterns) ? patterns : [patterns];

    // Result array
    const result = [];

    for (const pattern of patternList) {
        // Parse pattern: first part is include pattern, rest are exclude patterns
        const parts = pattern.split('|');
        const includePattern = parts[0];
        const excludePatterns = parts.slice(1).filter(p => p.trim());

        // Build actual glob pattern
        // If recursive is needed and pattern doesn't contain **, add ** to directory part
        let actualPattern = includePattern;
        if (recursive && !includePattern.includes('**')) {
            const dirname = path.dirname(includePattern);
            const basename = path.basename(includePattern);
            if (dirname === '.') {
                actualPattern = `**/${basename}`;
            } else {
                actualPattern = `${dirname}/**/${basename}`;
            }
        }

        // Create Glob objects for exclude patterns
        const excludeGlobs = excludePatterns.map(p => Glob(p));

        // Create Glob object and scan
        const glob = Glob(actualPattern);

        for (const file of glob.scanSync({ cwd })) {
            // Check if file matches any exclude pattern
            const basename = path.basename(file);
            let excluded = false;

            for (const excludeGlob of excludeGlobs) {
                // Exclude pattern can match full path or just filename
                if (excludeGlob.match(file) || excludeGlob.match(basename)) {
                    excluded = true;
                    break;
                }
            }

            if (!excluded) {
                result.push(file);
            }
        }
    }

    return result;
}

const ninja_src = file_list([
    'deps/ninja/src/getopt.c',
    'deps/ninja/src/*.cc|browse.cc|*posix.cc|*test.cc|*.in.cc',
    'ninja_api.cpp'
])


const compiler = 'clang-cl'
const defines = ['NINJA_BUILD_LIB', '_CRT_SECURE_NO_WARNINGS']
const obj_dir = 'build/obj'
const output_dir = 'build'

// Ensure output directories exist
mkdirSync(obj_dir, { recursive: true })
mkdirSync(output_dir, { recursive: true })

// Compile each source file
const objs = []
for (const src of ninja_src) {
    const baseName = path.basename(src, path.extname(src))
    const objPath = path.join(obj_dir, baseName + '.obj')
    objs.push(objPath)

    if (!needsRecompile(src, objPath)) {
        console.log(`Skipping: ${src} (up to date)`)
        continue;
    }

    const compileArgs = [
        '/c',
        '/EHsc',
        '/MD',
        '/O2',
        '/W3',
        `/Fo${objPath}`,
        src
    ]

    if (path.extname(src) === '.cpp') {
        compileArgs.push('/std:c++17')
    }

    for (const def of defines) {
        compileArgs.push(`/D${def}`)
    }

    compileArgs.push('/Ideps/ninja/src')

    console.log(`Compiling: ${src}`)
    const result = Bun.spawnSync([compiler, ...compileArgs], {
        cwd: process.cwd(),
        stdio: ['inherit', 'inherit', 'inherit']
    })

    if (result.exitCode !== 0) {
        console.error(`Failed to compile: ${src}`)
        process.exit(1)
    }
}

// Link all object files into DLL
const dllPath = path.join(output_dir, 'ninja.dll')
const linkArgs = [
    '/LD',           // Build DLL
    '/OUT:' + dllPath,
    ...objs,
    'shell32.lib',
    'shlwapi.lib'
]

console.log(`Linking: ${dllPath}`)
const linkResult = Bun.spawnSync([compiler, ...linkArgs], {
    cwd: process.cwd(),
    stdio: ['inherit', 'inherit', 'inherit']
})

if (linkResult.exitCode !== 0) {
    console.error('Failed to link')
    process.exit(1)
}

console.log('Build completed successfully!')

console.log('Compiling nj.cli.js to nj.exe...')
const compileResult = Bun.spawnSync(['bun', 'build', '--compile', '--outfile', 'nj.exe', '.\\nj.cli.js'], {
    cwd: process.cwd(),
    stdio: ['inherit', 'inherit', 'inherit']
})

if (compileResult.exitCode !== 0) {
    console.error('Failed to compile nj.cli.js')
    process.exit(1)
}

console.log('nj.exe created successfully!')

