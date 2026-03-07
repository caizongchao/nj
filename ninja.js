import os from 'os';
import process from 'process';
import path from 'path';
import { Glob } from "bun";
import { dlopen, FFIType, suffix as dlsuffix } from 'bun:ffi';
import { watch } from 'fs'

function apply_or_print(fx) {
    if(typeof fx === 'function') fx(); else console.log(fx);
}
function trace(...args) { console.log(...args); }

function exit(code) { process.exit(code); }

function fatal(...msgs) { console.error('[fatal]', ...msgs); process.exit(1); }

function path_change_extname(x, ext) {
    return path.join(path.dirname(x), path.basename(x, path.extname(x)) + ext);
}

export const is_windows = (os.platform() === 'win32');
export const is_macos = (os.platform() === 'darwin');
export const is_linux = (os.platform() === 'linux');

export const gensym = (function gensym() {
    let counter = 0; return function (prefix = '') {
        let result = ''; let num = counter; while (true) {
            const remainder = num % 26;
            result = String.fromCharCode(97 + remainder) + result;
            num = Math.floor(num / 26);
            if (num === 0) break;
            num--;
        }
        counter++; return prefix + '_' + result;
    };
})();

function is_valid(x) { return x !== undefined && x !== null; }

function is_function(x) { return typeof (x) === 'function'; }

function is_object(x, t) { t = t ? t : Object; return x instanceof t; }

function is_plain_object(x) { return is_object(x, Object) && x.constructor === Object; }

function is_array(a) { return is_object(a, Array); }

function is_string(s) { return typeof (s) === 'string'; }

function to_array(x) { return array_map(x); }

function array_map(x, fx) {
    if (!is_array(x)) x = (x === undefined) ? [] : [x]; if (fx) {
        let r = []; for (const a of x) {
            let b = fx(a); if (is_valid(b)) r.push(b);
        }

        return r;
    }

    return x;
}

function array_foreach(x, fx) {
    if (!is_array(x)) fx(x); else {
        for (const a of x) { if (fx(a) === false) return false; }

    }

    return true;
}

function array_deep_foreach(x, fx) {
    if (!is_array(x)) fx(x); else {
        for (const a of x) {
            if (is_array(a)) {
                if (array_deep_foreach(a, fx) === false) return false;
            }
            else {
                if (fx(a) === false) return false;
            }
        }
    }

    return true;
}

function array_deep_foreach_if(x, pred, fx) {
    if (!is_array(x)) fx(x); else {
        for (const a of x) {
            if (is_array(a)) {
                if (pred(a)) {
                    if (array_deep_foreach(a, fx) === false) return false;
                }
            }
            else {
                if (fx(a) === false) return false;
            }
        }
    }

    return true;
}

function array_append(r, ...xs) {
    for (const x of xs) {
        if (is_array(x)) array_append(r, ...x); else if (is_valid(x)) r.push(x);
    }

    return r;
}

function array_append_if(r, pred, ...xs) {
    for (const x of xs) {
        if (is_array(x)) array_append(r, ...x); else if (is_valid(x)) {
            if (pred(x)) r.push(x);
        }
    }

    return r;
}

function array_flatten(y, xs) {
    array_foreach(xs, x => {
        if (is_array(x)) array_flatten(y, x); else if (is_valid(x)) y.push(x);
    });

    return y;
}

function array_unique(y, xs) {
    for (const a of xs) {
        if (!y.includes(a)) y.push(a);
    }

    return y;
}

function array_is_empty(xs) { return !xs || xs.length === 0; }

function object_foreach(x, fx) {
    for (const [key, value] of Object.entries(x)) {
        if (fx(value, key) === false) break;
    }
}

function object_merge_key(y, k, v) {
    if (is_array(v)) {
        let x = y[k]; if (x === undefined) {
            // y[k] = [...v];
            y[k] = [v];
        }
        else if (is_array(x)) {
            // array_append(x, ...v);
            x.push(v);
        }
        else {
            y[k] = [x, v];
        }
    }
    else if (is_array(y[k])) {
        y[k].push(v);
    }
    else {
        y[k] = v;
    }
}

function object_merge(y, ...xs) {
    for (const a of xs) {
        if (is_object(a)) {
            for (const [key, value] of Object.entries(a)) {
                object_merge_key(y, key, value);
            }
        }
    }

    return y;
}

function object_merge_if(y, pred, ...xs) {
    for (const a of xs) {
        if (is_object(a)) {
            for (const [key, value] of Object.entries(a)) {
                if (pred(value, key)) {
                    object_merge_key(y, key, value);
                }
            }
        }
    }

    return y;
}

function object_flatten(y, ...xs) {
    for (const a of xs) {
        if (is_object(a)) {
            for (const [key, value] of Object.entries(a)) {
                object_merge_key(y, key, value);
            }
        }
    }

    return y;
}

function mixin(y, ...xs) {
    y = y || {}; xs = array_flatten([], xs); {
        if (!is_object(y.prototype, Proxy)) {
            const __mixin__ = []; const proto = new Proxy({}, {
                get(target, key) {
                    const len = __mixin__.length; for (let i = len - 1; i >= 0; i--) {
                        const x = __mixin__[i]; const v = x[key]; if (v !== undefined) return v;
                    }

                    return undefined;
                },
            });

            proto.__mixin__ = __mixin__; y.prototype = proto;
        }

        array_append_if(y.prototype.__mixin__, x => x !== undefined, ...xs);
    }

    return y;
}

export class basic_table extends Array {
    constructor(...xs) { super(); table_merge(this, ...xs); }

    static new(...xs) { return new basic_table(...xs); }
};

function is_table(t) { return is_object(t, basic_table); }

function table_merge(t, ...xs) {
    for (const x of xs) {
        if (is_array(x)) table_foreach(x, (v, k) => table_insert(t, v, k));
        else if (is_object(x)) object_foreach(x, (v, k) => table_insert(t, v, k));
        else t.push(x);
    }

    return t;
}

function table_merge_if(t, pred, ...xs) {
    for (const x of xs) {
        if (is_array(x)) table_foreach(x, (v, k) => {
            if (pred(v, k)) table_insert(t, v, k);
        });
        else if (is_object(x)) object_foreach(x, (v, k) => {
            if (pred(v, k)) table_insert(t, v, k);
        })
        else if (is_valid(x)) {
            if (pred(x)) t.push(x);
        }
    }

    return t;
}

function table_foreach(t, fx) {
    let i = 0; for (const a in t) {
        if (parseInt(a) === i++) {
            if (fx(t[a]) === false) return false;
        }
        else {
            if (fx(t[a], a) === false) return false;
        }
    }

    return true;
}

function table_deep_foreach(t, fx) {
    return table_foreach(t, (v, k) => {
        if (k === undefined) {
            if (is_array(v)) {
                if (table_deep_foreach(v, fx) === false) return false;
            }
            else {
                if (fx(v) === false) return false;
            }
        }
        else {
            if (fx(v, k) === false) return false;
        }
    });
}

function table_insert(t, v, k) {
    if (k === undefined) t.push(v); else {
        if (is_array(t[k])) {
            t[k].push(v);
        }
        else if (is_array(v)) {
            t[k] = [v];
        }
    }
}

function table_flatten(y, t) {
    for (const x of t) {
        if (is_array(x)) table_flatten(y, x);
        else if (is_object(x)) table_merge(y, x);
        else y.push(x);
    }

    return y;
}

function table_pick(y, t, x) {
    if (x === undefined) {
        y.push(t);
    }
    else {
        for (const a of t) {
            if (is_object(a, x)) y.push(a); else if (is_array(x)) table_pick(y, a, x);
        }
    }

    return y;
}

const utf8_encoder = new TextEncoder();

function to_cstring(x) { return utf8_encoder.encode(x + '\0').buffer; }

const libninja_path = `ninja.${dlsuffix}`;
// const libninja_path = `w:/projects/njx/debug/ninja.${dlsuffix}`;

const libninja_ffi = dlopen(libninja_path, {
    ninja_initialize: { args: [], returns: FFIType.void, },
    ninja_finalize: { args: [], returns: FFIType.void, },
    ninja_strings_new: { args: [], returns: FFIType.pointer, },
    ninja_strings_free: { args: [FFIType.pointer], returns: FFIType.void, },
    ninja_strings_add: { args: [FFIType.pointer, FFIType.cstring], returns: FFIType.void, },
    ninja_string_map_new: { args: [], returns: FFIType.pointer, },
    ninja_string_map_free: { args: [FFIType.pointer], returns: FFIType.void, },
    ninja_string_map_add: { args: [FFIType.pointer, FFIType.cstring, FFIType.cstring], returns: FFIType.void, },
    ninja_reset: { args: [], returns: FFIType.void, },
    ninja_clear: { args: [], returns: FFIType.void, },
    ninja_clean: { args: [], returns: FFIType.void, },
    ninja_var_get: { args: [FFIType.cstring], returns: FFIType.cstring, },
    ninja_var_set: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.void, },
    ninja_pool_add: { args: [FFIType.cstring, FFIType.int], returns: FFIType.void, },
    ninja_rule_new: { args: [FFIType.cstring], returns: FFIType.pointer, },
    ninja_rule_var_add: { args: [FFIType.pointer, FFIType.cstring, FFIType.cstring], returns: FFIType.void, },
    ninja_rule_make: { args: [FFIType.cstring, FFIType.pointer], returns: FFIType.pointer, },
    ninja_edge_add: { args: [FFIType.cstring, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer, FFIType.pointer], returns: FFIType.void, },
    ninja_default_add: { args: [FFIType.cstring], returns: FFIType.void, },
    ninja_buildlog_open: { args: [], returns: FFIType.void, },
    ninja_buildlog_close: { args: [], returns: FFIType.void, },
    ninja_exit_on_error: { args: [FFIType.bool], returns: FFIType.void, },
    ninja_build: { args: [FFIType.pointer], returns: FFIType.int, },
});

const ninja_api = {}; for (let [key, value] of Object.entries(libninja_ffi.symbols)) {
    if (key.startsWith('ninja_')) key = key.slice(6);

    ninja_api[key] = value;
}

ninja_api.initialize();

export const libninja = {};

libninja.with_strings = (xs, fx) => {
    const ss = ninja_api.strings_new(); {
        if (is_array(xs)) for (const x of xs) ninja_api.strings_add(ss, to_cstring(x));
        else ninja_api.strings_add(ss, to_cstring(xs));
    }

    const r = fx(ss); ninja_api.strings_free(ss); return r;
}

libninja.with_string_map = (xs, fx) => {
    const sm = ninja_api.string_map_new(); {
        if (is_array(xs)) {
            for (const x of xs) {
                for (const [key, value] of Object.entries(x)) ninja_api.string_map_add(sm, to_cstring(key), to_cstring(value));
            }
        }
        else {
            for (const [key, value] of Object.entries(xs)) ninja_api.string_map_add(sm, to_cstring(key), to_cstring(value));
        }
    }
    const r = fx(sm); ninja_api.string_map_free(sm); return r;
}

libninja.var = (key, value) => {
    if (value) ninja_api.var_set(to_cstring(key), to_cstring(value));
    else return ninja_api.var_get(to_cstring(key));
}

libninja.add_rule = (name, ...xs) => {
    libninja.with_string_map(array_flatten([], ...xs), (smap) => {
        ninja_api.rule_make(to_cstring(name), smap);
    })
}

libninja.add_edge = (rule_name, outputs, implicit_outputs, inputs, implicit_inputs, vars) => {
    libninja.with_strings(array_flatten([], outputs), (xoutputs) => {
        libninja.with_strings(array_flatten([], implicit_outputs), (ximplicit_outputs) => {
            libninja.with_strings(array_flatten([], inputs), (xinputs) => {
                libninja.with_strings(array_flatten([], implicit_inputs), (ximplicit_inputs) => {
                    libninja.with_string_map(array_flatten([], vars), (xvars) => {
                        ninja_api.edge_add(to_cstring(rule_name), xoutputs, ximplicit_outputs, xinputs, ximplicit_inputs, xvars);
                    });
                });
            });
        });
    });
}

libninja.build = (targets) => {
    libninja.with_strings(targets, (xtargets) => {
        ninja_api.build(xtargets);
    });
}

export function ninja_string_escape(s) {
    return s.replace(/[\s:$]/g, m => ({
        ' ': '$ ',
        ':': '$:',
        '$': '$$'
    }[m]));
}

export function ninja_path_escape(s) {
    return s.replace(/[\s:$]/g, m => ({
        ' ': '$ ',
        ':': '',
        '$': '$$'
    }[m]));
}

function option_is_switch(s) { return s.startsWith('-') || s.startsWith('/'); }

export class basic_options extends basic_table {
    static new(...xs) { return new basic_options(...xs); }
}

class public_options extends basic_options {
    static new(...xs) { return new public_options(...xs); }
}

export function $public(...xs) { return new public_options(...xs); }

class private_options extends basic_options {
    static new(...xs) { return new private_options(...xs); }
}

export function $private(...xs) { return new private_options(...xs); }

function is_options(x) { return is_object(x, basic_options); }

export function options_stringify(options, prefix = '-', sep = '=') {
    let result = []; table_deep_foreach(options, (value, key) => {
        if (key !== undefined) {
            result.push((option_is_switch(key) ? key : prefix + key) + (value ? sep + value : ''));
        }
        else if (value) {
            result.push(option_is_switch(value) ? value : prefix + value);
        }
    });

    return result.join(' ');
}

export const ninja = {
    os: os.platform(),
    arch: os.arch(),
    tools: {},
    toolchains: { default: 'clang' },
    target_classes: {},
    default_target_class: 'cc',
    targets: {},
    defaults: [],
};

ninja.cross_compile = (x, arch) => {
    ninja.os = x || os.platform(); ninja.arch = arch || os.arch();

    // ninja.toolchains.default = ninja.os + '-' + (ninja.arch == os.arch() ? '' : ninja.arch + '-') + 'clang';
    ninja.toolchains.default = ninja.os + '-' + 'clang';
}

const VAR_BUILD_DIR = 'builddir';

function ninja_build_dir(x) {
    if (x) { libninja.var(VAR_BUILD_DIR, x); return x; } else return libninja.var(VAR_BUILD_DIR);
}; ninja.build_dir = ninja_build_dir;

function toolchain_of(x) {
    var toolchain; if (!x) {
        toolchain = toolchain_of(ninja.toolchains.default);
    }
    else if (is_string(x)) {
        toolchain = ninja.toolchains[x]; if (!toolchain) {
            fatal(`toolchain ${x} not found`);
        }
    }
    else toolchain = x;

    return toolchain;
}; ninja.toolchain_of = toolchain_of;

function tool_of(x) {
    var tool; if (!x) {
        fatal(`tool not specified`);
    }
    else if (is_string(x)) {
        tool = ninja.tools[x]; if (!tool) {
            fatal(`tool ${x} not found`);
        }
    }
    else tool = x;

    return tool;
}; ninja.tool_of = tool_of;

function target_of(x) {
    var target; if (!x) {
        fatal(`target not specified`);
    }
    else if (is_string(x)) {
        target = ninja.targets[x]; if (!target) {
            fatal(`target ${x} not found`);
        }
    }
    else target = x;

    return target;
}; ninja[target_of] = target_of;

function files_foreach(filter, excludes, fx) {
    excludes = array_map(excludes, (x) => x ? Glob(x) : undefined);

    const basename = path.basename(filter), dirname = path.dirname(filter);

    const glob = Glob(basename); for (const x of glob.scanSync(dirname)) {
        let skip = false; for (const exclude of excludes) {
            if (exclude.match(x)) { skip = true; break; }
        }
        if (!skip) {
            if (fx(path.join(dirname, x)) === false) break;
        }
    }
};

export class basic_target {
    constructor(name, options) {
        this.name = name || gensym('target'); options = options || {};

        this.#tools['phony'] = phony.new(this);

        object_foreach(toolchain_of(options.toolchain), (value, key) => {
            this.#tools[key] = new value(this);
        });

        object_foreach(options.tools || {}, (value, key) => {
            this.#tools[key] = new value(this);
        });

        Object.assign(this, options);
    }

    static new(name, options) {
        let t = new this(name, options); {
            ninja.targets[t.name] = t;
        }

        return t;
    }

    #tools = {};

    tool(ext, t, options) {
        var x; if (typeof (t) === "function") {
            x = new t(this, options)
        }
        else {
            x = assign({}, t); {
                x.target = this; x.options = options || {};
            }
        }

        this.#tools[ext] = x; return x;
    }
    tools() { return this.#tools; }

    configure() { }

    build() { }

    #deps = [];

    dep(...xs) { this.#deps.push(...xs); return this; }
    deps() { return this.#deps; }

    deps_foreach(fx, ctx, depth) {
        if (!ctx) { ctx = new Set(); depth = 0; }

        array_deep_foreach_if(this.deps(),
            (x) => !((x instanceof basic_target) || ((x instanceof private_options) && (depth > 0))),
            (x) => {
                x = target_of(x); if (!ctx.has(x)) {
                    ctx.add(x); x.deps_foreach(fx, ctx, depth + 1); fx(x);
                }
            });
    }

    public(...xs) {
        for (const x of xs) {
            if (is_object(x)) {
                for (const [key, value] of Object.entries(x)) {
                    const fx = this[key]; if (is_function(fx)) {
                        fx.call(this, public_options.new(value));
                    }
                    else {
                        fatal(`public ${key} not found`);
                    }
                }
            }
        }

        return this;
    }

    private(...xs) {
        for (const x of xs) {
            if (is_object(x)) {
                for (const [key, value] of Object.entries(x)) {
                    const fx = this[key]; if (is_function(fx)) {
                        fx.call(this, private_options.new(value));
                    }
                    else {
                        fatal(`public ${key} not found`);
                    }
                }
            }
        }

        return this;
    }
};

const c_file_extensions = ['.c'];
const cxx_file_extensions = ['.cpp', '.cxx', '.cc', '.cu'];
const asm_file_extensions = ['.s', '.asm'];
const obj_file_extensions = ['.o', '.obj'];
const rc_file_extensions = ['.rc'];

function is_c_file(x) { return this.c_file_extensions.includes(path.extname(x).toLowerCase()); }
function is_cxx_file(x) { return this.cxx_file_extensions.includes(path.extname(x).toLowerCase()); }
function is_asm_file(x) { return this.asm_file_extensions.includes(path.extname(x).toLowerCase()); }

const c_option_fields = ['c_flags', 'cx_flags', 'defines', 'includes', 'include_dirs'];
const cxx_option_fields = ['cxx_flags', 'cx_flags', 'defines', 'includes', 'include_dirs'];
const as_option_fields = ['as_flags', 'defines', 'includes', 'include_dirs'];
const ld_option_fields = ['ld_flags', 'libs', 'lib_dirs'];

const win32_extensions = { binary: '.exe', shared: '.dll', static: '.lib', };
const posix_extensions = { binary: '', shared: '.so', static: '.a', };
const darwin_extensions = { binary: '', shared: '.dylib', static: '.a', };

function extension_of(type, os) {
    os = os || ninja.os; if (os == 'win32') {
        return win32_extensions[type];
    }
    else if (os == 'darwin') {
        return darwin_extensions[type];
    }
    else {
        return posix_extensions[type];
    }
}

class basic_cc_target extends basic_target {
    #type = undefined;

    type(x) { if (x) { this.#type = x; return this; } else return this.#type; }

    #output;

    output(x) { if (x) { this.#output = x; return this; } else return this.#output; }

    #dep_type = 'gcc'

    dep_type(x) { if (x) { this.#dep_type = x; return this; } else return this.#dep_type; }

    #cxx_pch;

    cxx_pch(x) { if (x) { this.#cxx_pch = x; return this; } else return this.#cxx_pch; }

    #srcs = [];

    src(...xs) { this.#srcs.push(...xs); return this; }
    srcs() { return this.#srcs; }

    #include_dirs = [];

    include_dir(...xs) { this.#include_dirs.push(...xs); return this; }
    include_dirs() { return this.#include_dirs; }

    #defines = [];

    define(...xs) { this.#defines.push(...xs); return this; }
    defines() { return this.#defines; }

    #includes = [];

    include(...xs) { this.#includes.push(...xs); return this; }
    includes() { return this.#includes; }

    #c_flags = [];

    c_flag(...xs) { this.#c_flags.push(...xs); return this; }
    c_flags() { return this.#c_flags; }

    #cx_flags = [];

    cx_flag(...xs) { this.#cx_flags.push(...xs); return this; }
    cx_flags() { return this.#cx_flags; }

    #cxx_flags = [];

    cxx_flag(...xs) { this.#cxx_flags.push(...xs); return this; }
    cxx_flags() { return this.#cxx_flags; }

    #as_flags = [];

    as_flag(...xs) { this.#as_flags.push(...xs); return this; }
    as_flags() { return this.#as_flags; }

    #ld_flags = [];

    ld_flag(...xs) { this.#ld_flags.push(...xs); return this; }
    ld_flags() { return this.#ld_flags; }

    #lib_dirs = [];

    lib_dir(...xs) { this.#lib_dirs.push(...xs); return this; }
    lib_dirs() { return this.#lib_dirs; }

    #ar_flags = [];

    ar_flag(...xs) { this.#ar_flags.push(...xs); return this; }
    ar_flags() { return this.#ar_flags; }

    #libs = [];

    lib(...xs) { this.#libs.push(...xs); return this; }
    libs() { return this.#libs; }

    options() {
        let result = {}; {
            if (!array_is_empty(this.#defines)) result.defines = this.#defines;
            if (!array_is_empty(this.#include_dirs)) result.include_dirs = this.#include_dirs;
            if (!array_is_empty(this.#includes)) result.includes = this.#includes;
            if (!array_is_empty(this.#lib_dirs)) result.lib_dirs = this.#lib_dirs;
            if (!array_is_empty(this.#libs)) result.libs = this.#libs;
            if (!array_is_empty(this.#c_flags)) result.c_flags = this.#c_flags;
            if (!array_is_empty(this.#cx_flags)) result.cx_flags = this.#cx_flags;
            if (!array_is_empty(this.#cxx_flags)) result.cxx_flags = this.#cxx_flags;
            if (!array_is_empty(this.#as_flags)) result.as_flags = this.#as_flags;
            if (!array_is_empty(this.#ld_flags)) result.ld_flags = this.#ld_flags;
            if (!array_is_empty(this.#ar_flags)) result.ar_flags = this.#ar_flags;
        }

        return result;
    }

    #default = false;

    default(x) { if (x !== undefined) { this.#default = x; return this; } else return this.#default; }

    configured = false;

    configure() {
        if (this.configured) { return; }

        this.deps_foreach((dep) => { dep.configure(); });

        const build_dir_root = ninja_build_dir();

        const build_dir = path.join(build_dir_root, this.name); {
            this.build_dir_root = build_dir_root; this.build_dir = build_dir;
        }

        if (!this.#type) {
            if (this.name.endsWith('.public')) this.#type = 'phony';
            else fatal(`unknown target type for ${this.name}`);
        }

        if (!this.#output) {
            this.#output = (this.#type === 'phony') ? undefined : path.join(build_dir_root, this.name + extension_of(this.#type));
        }

        const output = this.#output;

        let defines = table_merge([], this.#defines);
        let include_dirs = table_merge([], this.#include_dirs);
        let includes = table_merge([], this.#includes);
        let lib_dirs = table_merge([], this.#lib_dirs);
        let libs = table_merge([], this.#libs);

        let c_flags = table_merge([], this.#c_flags);
        let cx_flags = table_merge([], this.#cx_flags);
        let cxx_flags = table_merge([], this.#cxx_flags);
        let as_flags = table_merge([], this.#as_flags);
        let ld_flags = table_merge([], this.#ld_flags);
        let ar_flags = table_merge([], this.#ar_flags);

        let option_filter = undefined; this.deps_foreach((dep) => {
            option_filter = (dep.type() === 'phony') ? undefined : public_options;

            table_merge(defines, table_pick([], dep.defines(), option_filter));
            table_merge(include_dirs, table_pick([], dep.include_dirs(), option_filter));
            table_merge(includes, table_pick([], dep.includes(), option_filter));
            table_merge(lib_dirs, table_pick([], dep.lib_dirs(), option_filter));
            table_merge(libs, table_pick([], dep.libs(), option_filter));

            table_merge(c_flags, table_pick([], dep.c_flags(), option_filter));
            table_merge(cx_flags, table_pick([], dep.cx_flags(), option_filter));
            table_merge(cxx_flags, table_pick([], dep.cxx_flags(), option_filter));
            table_merge(as_flags, table_pick([], dep.as_flags(), option_filter));
            table_merge(ld_flags, table_pick([], dep.ld_flags(), option_filter));
            table_merge(ar_flags, table_pick([], dep.ar_flags(), option_filter));
        });

        const tools = this.tools();

        const objs = []; this.objs = objs; const src_walk = (x, opts) => {
            array_deep_foreach(x, (src) => {
                if (is_object(src) && src.src) {
                    let t = new this.constructor(); {
                        object_foreach(src, (value, key) => {
                            if (key !== 'src') {
                                let kf = this[key]; if (is_function(kf)) {
                                    kf.call(t, value);
                                }
                            }
                        });
                    }

                    let topts = t.options();

                    let opts2 = object_merge({}, opts, topts); {
                        opts2.rules = {};
                    }

                    src_walk(src.src, opts2);
                }
                else {
                    let default_tool = opts.tool;

                    const [filter, ...excludes] = src.split('|'); files_foreach(filter, excludes,
                        (file) => {
                            const ext = path.extname(file).toLowerCase();

                            let tool = default_tool || tools[ext]; if(!tool) {
                                // if (!tool) fatal(`no tool for ${file}`);
                                objs.push(file)
                            }
                            else {
                                tool.run(file, opts)
                            }
                        });
                }
            });
        };

        const options = {
            rules: {},
            defines, include_dirs, includes, lib_dirs, libs,
            c_flags, cx_flags, cxx_flags, as_flags, ld_flags, ar_flags,
        };

        src_walk(this.#srcs, options);

        const ld = tools[this.type()]; ld.run(output, options);

        if (this.#default) {
            libninja.default_add(output);
        }

        this.configured = true;
    }

    build() {
        if (!this.configured) this.configure();

        if (this.#output) {
            libninja.build(this.#output);
        }
    }
}

ninja.target_classes.cc = basic_cc_target;

export class basic_tool {
    name = 'basic'; target; options; input;

    constructor(target) { this.target = target; }

    static new(target) { return new this(target); }

    rule(x) {
        if (x !== undefined) {
            this.options.rules[this.constructor.name] = x; return this;
        }
        else {
            let r = this.options.rules[this.constructor.name]; return r;
        }
    }

    configured() {
        return this.rule() !== undefined;
    }

    configure() {
        if (!this.configured()) {
            this.rule(gensym(this.name)); this.prepare();
        }
    }

    prepare() { }

    build() { }

    run(file, options) {
        this.options = options || { rules: {} }; this.input = file;

        this.configure(); this.build();
    }
};

export class phony extends basic_tool {
    name = 'phony';

    // build() {
    //     const objs = this.target.objs; if (objs.length === 0) {
    //         this.target.output(''); return;
    //     }

    //     libninja.add_edge('phony', this.target.output(), null, objs, null, null);
    // }
}

export class objtool extends basic_tool {
    name = 'obj';

    build() {
        const obj = ninja_path_escape(this.input); this.target.objs.push(obj);
    }
};

export class rcc extends basic_tool {
    name = 'llvm-rc';

    switch_prefix = '/';
    define_prefix = '/D';
    include_dir_prefix = '/I';

    command() {
        return [
            this.name,
            '$in /FO $out',
            options_stringify(this.options.rc_flags, this.switch_prefix),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            description: 'RC $in',
        });
    }

    build() {
        const obj = path.join(this.target.build_dir, ninja_path_escape(this.input) + '.res'); {
            this.target.objs.push(obj);
        }

        libninja.add_edge(this.rule(), obj, null, ninja_string_escape(this.input), null, null);
    }
};

export class gcc extends basic_tool {
    name = 'gcc';

    switch_prefix = '-';
    define_prefix = '-D';
    include_dir_prefix = '-I';
    include_prefix = '-include';
    lib_dir_prefix = '-L';
    lib_prefix = '-l';

    command() {
        return [
            this.name,
            '-c $in -o $out -MMD -MF $out.d',
            options_stringify(this.options.c_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            deps: 'gcc',
            depfile: '$out.d',
            description: 'CC $in',
        });
    }

    build() {
        const obj = path.join(this.target.build_dir, ninja_path_escape(this.input) + '.o'); {
            this.target.objs.push(obj);
        }

        libninja.add_edge(this.rule(), obj, null, ninja_string_escape(this.input), null, null);
    }
};

export class gxx extends gcc {
    name = 'g++';

    command() {
        return [
            this.name,
            '-c $in -o $out -MMD -MF $out.d',
            options_stringify(this.options.c_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.cxx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
            this.target.cxx_pch() ? ('-include ' + this.target.cxx_pch()) : '',
        ].join(' ');
    }
};

export class gas extends gcc {
    name = 'as';

    command() {
        return [
            this.name,
            options_stringify(this.options.as_flags),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            description: 'AS $in',
        });
    }
};

export class gcc_ar extends basic_tool {
    name = 'ar';

    command() {
        return [
            this.name,
            'rcs $out $in',
            options_stringify(this.options.ar_flags),
        ].join(' ');
    }

    prepare() {
        if (this.target.objs.length > 32) {
            libninja.add_rule(
                this.rule(), {
                command: this.command().replace(' $in', ' @$out.rsp'),
                rspfile: '$out.rsp',
                rspfile_content: '$in',
                description: 'AR $out',
            })
        }
        else {
            libninja.add_rule(
                this.rule(), {
                command: this.command(),
                description: 'AR $out',
            })
        }
    }

    build() {
        const deps = []; this.target.deps_foreach((dep) => {
            if (dep.output()) deps.push(ninja_path_escape(dep.output()));
        });

        libninja.add_edge(this.rule(), this.target.output(), null, this.target.objs, deps, null);
    }
};

export class gcc_ld extends gcc {
    name = 'g++';

    command() {
        return [
            this.name,
            '$in -o $out',
            this.target.type() === 'shared' ? '-shared' : '',
            options_stringify(this.options.ld_flags),
            options_stringify(this.options.lib_dirs, this.lib_dir_prefix),
            options_stringify(this.options.libs, this.lib_prefix),
        ].join(' ');
    }

    prepare() {
        if (this.target.objs.length > 32) {
            libninja.add_rule(
                this.rule(), {
                command: this.command().replace(' $in', ' @$out.rsp'),
                rspfile: '$out.rsp',
                rspfile_content: '$in',
                description: 'LD $out',
            })
        }
        else {
            libninja.add_rule(
                this.rule(), {
                command: this.command(),
                description: 'LD $out',
            })
        }
    }

    build() {
        this.target.deps_foreach((dep) => {
            if (dep.output()) this.target.objs.push(ninja_path_escape(dep.output()))
        });

        libninja.add_edge(this.rule(), this.target.output(), null, this.target.objs, null, null);
    }
};

const gcc_toolchain = { binary: gcc_ld, shared: gcc_ld, static: gcc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { gcc_toolchain[ext] = gcc; });
    array_foreach(cxx_file_extensions, (ext) => { gcc_toolchain[ext] = gxx; });
    array_foreach(asm_file_extensions, (ext) => { gcc_toolchain[ext] = gcc; });
    array_foreach(obj_file_extensions, (ext) => { gcc_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { gcc_toolchain[ext] = rcc; });
}

ninja.toolchains.gcc = gcc_toolchain;

// clang/llvm
export class clang extends gcc {
    name = 'clang';
};

export class clangxx extends gxx {
    name = 'clang++';
};

export class llvm_ar extends gcc_ar {
    name = 'llvm-ar';
}

export class llvm_ld extends gcc_ld {
    name = 'clang++';
}

const clang_toolchain = { binary: llvm_ld, shared: llvm_ld, static: llvm_ar, }; {
    array_foreach(c_file_extensions, (ext) => { clang_toolchain[ext] = clang; });
    array_foreach(cxx_file_extensions, (ext) => { clang_toolchain[ext] = clangxx; });
    array_foreach(asm_file_extensions, (ext) => { clang_toolchain[ext] = clang; });
    array_foreach(obj_file_extensions, (ext) => { clang_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { clang_toolchain[ext] = rcc; });
}

ninja.toolchains.clang = clang_toolchain;

// clang32
export class clang32 extends gcc {
    name = 'clang32';
};

export class clang32xx extends gxx {
    name = 'clang32++';
};

export class llvm_ar32 extends gcc_ar {
    name = 'llvm-ar';
}

export class llvm_ld32 extends gcc_ld {
    name = 'clang32++';
}

const clang32_toolchain = { binary: llvm_ld32, shared: llvm_ld32, static: llvm_ar32, }; {
    array_foreach(c_file_extensions, (ext) => { clang32_toolchain[ext] = clang32; });
    array_foreach(cxx_file_extensions, (ext) => { clang32_toolchain[ext] = clang32xx; });
    array_foreach(asm_file_extensions, (ext) => { clang32_toolchain[ext] = clang32; });
    array_foreach(obj_file_extensions, (ext) => { clang32_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { clang32_toolchain[ext] = rcc; });
}

ninja.toolchains.clang32 = clang32_toolchain;

// cosmocc
export class cosmocc extends gcc {
    name = 'cosmocc';
};

export class cosmocxx extends gxx {
    name = 'cosmoc++';
};

export class cosmo_ar extends gcc_ar {
    name = 'cosmoar';
};

export class cosmo_ld extends gcc_ld {
    name = 'cosmoc++';
};

const cosmo_toolchain = { binary: cosmo_ld, shared: cosmo_ld, static: cosmo_ar, }; {
    array_foreach(c_file_extensions, (ext) => { cosmo_toolchain[ext] = cosmocc; });
    array_foreach(cxx_file_extensions, (ext) => { cosmo_toolchain[ext] = cosmocxx; });
    array_foreach(asm_file_extensions, (ext) => { cosmo_toolchain[ext] = cosmocc; });
    array_foreach(obj_file_extensions, (ext) => { cosmo_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { cosmo_toolchain[ext] = rcc; });
}

ninja.toolchains.cosmo = cosmo_toolchain;

// zig
export class zigcc extends gcc {
    name = 'zig cc';
};

export class zigcxx extends gxx {
    name = 'zig c++';
};

export class zig_ar extends gcc_ar {
    name = 'zig ar';
}

export class zig_ld extends gcc_ld {
    name = 'zig c++';
}

const zig_toolchain = { binary: zig_ld, shared: zig_ld, static: zig_ar, }; {
    array_foreach(c_file_extensions, (ext) => { zig_toolchain[ext] = zigcc; });
    array_foreach(cxx_file_extensions, (ext) => { zig_toolchain[ext] = zigcxx; });
    array_foreach(asm_file_extensions, (ext) => { zig_toolchain[ext] = zigcc; });
    array_foreach(obj_file_extensions, (ext) => { zig_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { zig_toolchain[ext] = rcc; });
}

ninja.toolchains.zig = zig_toolchain;

// msvc
export class msvc extends basic_tool {
    name = 'cl';

    switch_prefix = '/';
    define_prefix = '/D';
    include_dir_prefix = '/I';
    include_prefix = '/FI';
    lib_dir_prefix = '/LIBPATH:';
    lib_prefix = '';

    command() {
        return [
            this.name,
            '/nologo /showIncludes',
            '/c $in /Fo$out',
            `/FS /Fd${path.join(this.target.build_dir_root, this.target.name + '.pdb')}`,
            options_stringify(this.options.c_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            deps: 'msvc',
            depfile: '$out.d',
            description: 'CC $in',
        });
    }

    build() {
        const obj = path.join(this.target.build_dir, ninja_path_escape(this.input) + '.o'); {
            this.target.objs.push(obj);
        }

        libninja.add_edge(this.rule(), obj, null, ninja_string_escape(this.input), null, null);
    }
};

export class msvcxx extends msvc {
    name = 'cl';

    command() {
        return [
            this.name,
            '/nologo /showIncludes',
            '/c $in /Fo$out',
            `/FS /Fd${path.join(this.target.build_dir_root, this.target.name + '.pdb')}`,
            options_stringify(this.options.cxx_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
        ].join(' ');
    }
};

export class msvc_as extends msvc {
    name = 'ml64';

    command() {
        return [
            this.name,
            '/nologo',
            '/c /Fo$out $in',
            options_stringify(this.options.as_flags),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            description: 'AS $in',
        });
    }
};

export class msvc_ar extends gcc_ar {
    name = 'lib';

    command() {
        return [
            this.name,
            '/nologo',
            '/OUT:$out $in',
            options_stringify(this.options.ar_flags),
        ].join(' ');
    }
};

export class msvc_ld extends gcc_ld {
    name = 'link';

    lib_dir_prefix = '/LIBPATH:';
    lib_prefix = '';

    command() {
        return [
            this.name,
            '/nologo',
            this.target.type() === 'shared' ? '/DLL' : '',
            '/OUT:$out $in',
            options_stringify(this.options.ld_flags),
            options_stringify(this.options.lib_dirs, this.lib_dir_prefix),
            options_stringify(this.options.libs, this.lib_prefix),
        ].join(' ');
    }

    build() {
        const objs = this.target.objs; const deps = [];

        this.target.deps_foreach((dep) => {
            if (dep.output()) {
                objs.push(path_change_extname(dep.output(), '.lib'));
                deps.push(ninja_path_escape(dep.output()));
            }
        });

        let implicit_output = null; if (this.target.type() === 'shared') {
            implicit_output = path_change_extname(this.target.output(), '.lib');
        }

        libninja.add_edge(this.rule(), this.target.output(), implicit_output, objs, deps, null);
    }
};

const msvc_toolchain = { binary: msvc_ld, shared: msvc_ld, static: msvc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { msvc_toolchain[ext] = msvc; });
    array_foreach(cxx_file_extensions, (ext) => { msvc_toolchain[ext] = msvcxx; });
    array_foreach(asm_file_extensions, (ext) => { msvc_toolchain[ext] = msvc_as; });
    array_foreach(obj_file_extensions, (ext) => { msvc_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { msvc_toolchain[ext] = rcc; });
}

ninja.toolchains.msvc = msvc_toolchain;

// msvc32
export class msvc32 extends msvc {
    name = 'cl32';
};

export class msvcxx32 extends msvcxx {
    name = 'cl32';
};

export class msvc32_as extends msvc_as {
    name = 'ml';
};

export class msvc32_ld extends msvc_ld {
    name = 'link32';
};

const msvc32_toolchain = { binary: msvc32_ld, shared: msvc32_ld, static: msvc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { msvc32_toolchain[ext] = msvc32; });
    array_foreach(cxx_file_extensions, (ext) => { msvc32_toolchain[ext] = msvcxx32; });
    array_foreach(asm_file_extensions, (ext) => { msvc32_toolchain[ext] = msvc32_as; });
    array_foreach(obj_file_extensions, (ext) => { msvc32_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { msvc32_toolchain[ext] = rcc; });
}

ninja.toolchains.msvc32 = msvc32_toolchain;

// clangcl32
export class clangcl32 extends msvc {
    name = 'clangcl32';
};

export class clangclxx32 extends msvcxx {
    name = 'clangcl32';
};

export class clangcl32_as extends msvc_as {
    name = 'ml';
};

export class clangcl32_ld extends msvc_ld {
    name = 'link32';
};

const clangcl32_toolchain = { binary: clangcl32_ld, shared: clangcl32_ld, static: msvc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { clangcl32_toolchain[ext] = clangcl32; });
    array_foreach(cxx_file_extensions, (ext) => { clangcl32_toolchain[ext] = clangclxx32; });
    array_foreach(asm_file_extensions, (ext) => { clangcl32_toolchain[ext] = clangcl32_as; });
    array_foreach(obj_file_extensions, (ext) => { clangcl32_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { clangcl32_toolchain[ext] = rcc; });
}

ninja.toolchains.clangcl32 = clangcl32_toolchain;

// clangcl
export class clangcl extends msvc {
    name = 'clangcl';
};

export class clangclxx extends msvcxx {
    name = 'clangcl';
};

export class clangcl_as extends msvc_as {
    // name = 'ml64';
};

export class clangcl_ld extends msvc_ld {
    name = 'link';
};

const clangcl_toolchain = { binary: clangcl_ld, shared: clangcl_ld, static: msvc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { clangcl_toolchain[ext] = clangcl; });
    array_foreach(cxx_file_extensions, (ext) => { clangcl_toolchain[ext] = clangclxx; });
    array_foreach(asm_file_extensions, (ext) => { clangcl_toolchain[ext] = clangcl_as; });
    array_foreach(obj_file_extensions, (ext) => { clangcl_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { clangcl_toolchain[ext] = rcc; });
}

ninja.toolchains.clangcl = clangcl_toolchain;

// nvcc
export class nvcc extends gcc {
    name = 'nvcc';

    command() {
        return [
            this.name,
            is_windows ?
                '-c $in -o $out -MD -MF $out.d' :
                '-c $in -o $out -MMD -MF $out.d',
            is_windows ?
                `-Xcompiler /FS,/Fd${path.join(this.target.build_dir_root, this.target.name + '.pdb')}` : '',
            options_stringify(this.options.c_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.cxx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
        ].join(' ');
    }

    prepare() {
        libninja.add_rule(
            this.rule(), {
            command: this.command(),
            deps: is_windows ? 'msvc' : 'gcc',
            depfile: '$out.d',
            description: 'CC $in',
        });
    }
};

export const nvcxx = nvcc;

export const nvcc_ld = nvcc;

export const nvcc_ar = is_windows ? msvc_ar : gcc_ar;

const nvcc_toolchain = { binary: nvcc_ld, shared: nvcc_ld, static: nvcc_ar, }; {
    array_foreach(c_file_extensions, (ext) => { nvcc_toolchain[ext] = nvcc; });
    array_foreach(cxx_file_extensions, (ext) => { nvcc_toolchain[ext] = nvcxx; });
    array_foreach(asm_file_extensions, (ext) => { nvcc_toolchain[ext] = nvcc; });
    array_foreach(obj_file_extensions, (ext) => { nvcc_toolchain[ext] = objtool; });
}

ninja.toolchains.nvcc = nvcc_toolchain;

// android clang
export class android_clang extends gcc {
    name = 'android-clang';
};

export class android_clangxx extends gxx {
    name = 'android-clang++';
};

export class android_llvm_ar extends gcc_ar {
    name = 'android-llvm-ar';
}

export class android_llvm_ld extends gcc_ld {
    name = 'android-clang++';
}

const android_clang_toolchain = { binary: android_llvm_ld, shared: android_llvm_ld, static: android_llvm_ar, }; {
    array_foreach(c_file_extensions, (ext) => { android_clang_toolchain[ext] = android_clang; });
    array_foreach(cxx_file_extensions, (ext) => { android_clang_toolchain[ext] = android_clangxx; });
    array_foreach(asm_file_extensions, (ext) => { android_clang_toolchain[ext] = android_clang; });
    array_foreach(obj_file_extensions, (ext) => { android_clang_toolchain[ext] = objtool; });
}

ninja.toolchains['android-clang'] = android_clang_toolchain;

// bcc32
export class bcc32 extends gcc {
    name = 'bcc32';

    command() {
        return [
            this.name,
            // '-q -c -o $out -mm mo$out.d',
            '-q -c -o $out',
            options_stringify(this.options.c_flags),
            options_stringify(this.options.cx_flags),
            options_stringify(this.options.defines, this.define_prefix),
            options_stringify(this.options.include_dirs, this.include_dir_prefix),
            options_stringify(this.options.includes, this.include_prefix),
            '$in'
        ].join(' ');
    }
};

export class bccxx32 extends gxx {
    name = 'bcc32';
};

export class bcc32_as extends gas {
    name = 'tasm';
};

export class bcc32_ar extends basic_tool {
    name = 'tlib';

    command() {
        // this.target.objs -> -+obj1 -+obj2
        let objs = ''; for (let i = 0; i < this.target.objs.length; i++) {
            objs += ' -+' + this.target.objs[i];
        }

        return [
            this.name,
            '$out', objs,
            options_stringify(this.options.ar_flags),
        ].join(' ');
    }
};

export class bcc32_ld extends gcc_ld {
    name = 'ilink32';

    command() {
        return [
            this.name, '-q',
            options_stringify(this.options.lib_dirs, this.lib_dir_prefix),
            options_stringify(this.options.ld_flags),
            this.options.libs.join(' '),
            '$in, $out',
        ].join(' ');
    }
};

const bcc32_toolchain = { binary: bcc32_ld, shared: bcc32_ld, static: bcc32_ar, }; {
    array_foreach(c_file_extensions, (ext) => { bcc32_toolchain[ext] = bcc32; });
    array_foreach(cxx_file_extensions, (ext) => { bcc32_toolchain[ext] = bccxx32; });
    array_foreach(asm_file_extensions, (ext) => { bcc32_toolchain[ext] = bcc32_as; });
    array_foreach(obj_file_extensions, (ext) => { bcc32_toolchain[ext] = objtool; });
    array_foreach(rc_file_extensions, (ext) => { bcc32_toolchain[ext] = rcc; });
}

ninja.toolchains.bcc32 = bcc32_toolchain;

ninja.target = function (name, options) {
    name = name || gensym('target');

    const target = new ninja.target_classes[options?.type || ninja.default_target_class](name, options); {
        ninja.targets[name] = target;
    }

    return target;
}

ninja.build = function (...targets) {
    if (targets.length === 0) {
        for (const target of Object.values(ninja.targets)) target.build();
    }
    else {
        for (const target of targets) target_of(target).build();
    }
}

ninja.watch = function (dir, file_exts, options, fx, msg) {
    const debounceTime = 300; let timeoutId = undefined;

    watch(dir ? dir : import.meta.dir, options ? options : { recursive: true },
        (event, filename) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                if (!file_exts || file_exts.includes(path.extname(filename))) {
                    ninja_api.reset(); fx(filename); apply_or_print(msg);
                }
            }, debounceTime);
        }
    );
    
    fx("."); apply_or_print(msg);
}

ninja.watch_cxx = function (dir, options, fx, msg) {
    ninja.watch(dir, ['.cpp', '.cc', '.cxx', '.c++', '.C', '.c', '.h', '.hpp', '.inc'], options, fx, msg);
}
