import path from 'path'

function trace(...args) { console.log(...args) }
function timestamp() { return new Date().toTimeString().split(' ')[0] }

ninja.toolchains.default = 'clangcl'

const debug = ninja.argv.includes('--release') ? false : true; {
    ninja.build_dir(debug ? 'debug' : 'release')
}

const NINJA_DIR = 'deps/ninja/'

ninja.target('cc')
    .type('phony')
    .define(debug ? '' : 'NDEBUG')
    .define('_CRT_SECURE_NO_WARNINGS', '_CRT_NONSTDC_NO_WARNINGS', '_SILENCE_ALL_CXX20_DEPRECATION_WARNINGS', '_USE_MATH_DEFINES')
    .cx_flag('/w')
    .cx_flag('/Z7', debug ? '' : '/O2', '/MT', '/arch:AVX')
    .cxx_flag('/std:c++20', '/EHsc')
    .ld_flag('/DEBUG', debug ? '' : '/OPT:REF')
    .ld_flag('/DYNAMICBASE:NO')
    .include_dir(NINJA_DIR + 'src')

ninja.target('ninja')
    .type('shared')
    .dep('cc')
    .define('NINJA_BUILD_LIB')
    .include_dir('deps/ninja/src')
    .src(
        'deps/ninja/src/getopt.c',
        'deps/ninja/src/*.cc|browse.cc|*posix.cc|*test.cc|*.in.cc'
    )
    .src('*.cpp')

ninja.build()

