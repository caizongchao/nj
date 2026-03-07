#include <cstdio>
#if !(defined(NINJA_BUILD_LIB) || defined(NINJA_BUILD_SHARED))
#    define NINJA_BUILD_LIB
#endif

#include "ninja_api.h"

#ifndef DEFAULT_BUILD_DIR
#    define DEFAULT_BUILD_DIR "build"
#endif

static std::string $buf;

static bool fatal(const char * fmt, ...) {
    va_list ap; va_start(ap, fmt); {
        vprintf(fmt, ap);
    }

    exit(1); return true;
}

static bool ninja_evalstring_read(const char * s, EvalString * eval, bool path);

static std::string ninja_path_read(BindingEnv * env, const char * s, uint64_t * slash_bits = 0);

typedef std::vector<std::string> ninja_strings;

NINJA_API void * ninja_strings_new() { return new ninja_strings(); }

NINJA_API void ninja_strings_free(void * v) { delete(ninja_strings *)v; }

NINJA_API void ninja_strings_add(void * v, const char * s) {
    ((ninja_strings *)v)->push_back(s);
}

typedef std::map<std::string, std::string> ninja_string_map;

NINJA_API void * ninja_string_map_new() { return new ninja_string_map(); }

NINJA_API void ninja_string_map_free(void * x) { delete(ninja_string_map *)x; }

NINJA_API void ninja_string_map_add(void * x, const char * k, const char * v) {
    ((ninja_string_map *)x)->insert(std::make_pair(k, v));
}

NINJA_API void ninja_reset() { $ninja.state().Reset(); }

NINJA_API void ninja_clear() {
    auto & state = $ninja.state(); {
        state.paths_.clear(); state.edges_.clear();
    }
}

NINJA_API void ninja_clean() {
    Cleaner cleaner(&($ninja.state()), $ninja.config, &($ninja.main.disk_interface_)); cleaner.CleanAll(true);
}

NINJA_API const char * ninja_var_get(const char * key) {
    $buf = $ninja.state().bindings_.LookupVariable(key); return $buf.c_str();
}

NINJA_API void ninja_var_set(const char * key, const char * value) { $ninja.env().AddBinding(key, value); }

NINJA_API void ninja_pool_add(const char * name, int depth) {
    auto & state = $ninja.state();

    (state.LookupPool(name) != nullptr) || fatal("duplicate pool '%s'", name);
    (depth >= 0) || fatal("invalid pool depth %d", depth);

    state.AddPool(new Pool(name, depth));
}

NINJA_API void * ninja_rule_new(const char * name) {
    auto & env = $ninja.env(); {
        if(env.LookupRuleCurrentScope(name) != nullptr) return 0;
    }

    auto & state = $ninja.state();

    auto r = new Rule(name); {
        state.bindings_.AddRule(r);
    }

    return r;
}

NINJA_API void ninja_rule_var_add(Rule * r, const char * key, const char * val) {
    auto & env = $ninja.env();

    Rule::IsReservedBinding(key) || fatal("unexpected variable '%s'", key);

    EvalString es; {
        ninja_evalstring_read(val, &es, false);
    }

    r->AddBinding(key, es);
}

NINJA_API void * ninja_rule_make(const char * name, ninja_string_map * vars) {
    auto r = (Rule *)ninja_rule_new(name); {
        for(auto const & [key, val] : *vars) {
            Rule::IsReservedBinding(key) || fatal("unexpected variable '%s'", key.c_str());

            EvalString es; {
                ninja_evalstring_read(val.c_str(), &es, false);
            }

            r->AddBinding(key, es);
        }
    }

    return r;
}

NINJA_API void ninja_edge_add(const char * rule_name, ninja_strings * outputs, ninja_strings * implicit_outputs, ninja_strings * inputs, ninja_strings * implicit_inputs, ninja_string_map * vars) {
    (rule_name != nullptr) || fatal("missing rule name");

    auto & $state = $ninja.state(); auto & $env = $ninja.env();

    const Rule * rule = $env.LookupRule(rule_name); {
        (rule != nullptr) || fatal("unknown rule '%s'", rule_name);
    }

    BindingEnv * env = vars->empty() ? &$env : new BindingEnv($env); if(!vars->empty()) {
        for(auto const & [k, v] : *vars) {
            env->AddBinding(k.c_str(), v.c_str());
        }
    }

    Edge * edge = $state.AddEdge(rule); edge->env_ = env;

    std::string pool_name = edge->GetBinding("pool"); if(!pool_name.empty()) {
        Pool * pool = $state.LookupPool(pool_name); {
            (pool != nullptr) || fatal("unknown pool name '%s'", pool_name.c_str());
        }

        edge->pool_ = pool;
    }

    std::string err; int c;

    // outputs
    for(auto const & v : *outputs) {
        uint64_t slash_bits;
        std::string path = ninja_path_read(edge->env_, v.c_str(), &slash_bits);
        $state.AddOut(edge, path, slash_bits, &err) || fatal("%s", err.c_str());
    }

    c = 0; for(auto const & v : *implicit_outputs) {
        uint64_t slash_bits;
        std::string path = ninja_path_read(edge->env_, v.c_str(), &slash_bits);
        $state.AddOut(edge, path, slash_bits, &err) || fatal("%s", err.c_str());
        ++c;
    }

    !edge->outputs_.empty() || fatal("build does not have any outputs");

    edge->implicit_outs_ = c;

    // inputs
    for(auto const & v : *inputs) {
        uint64_t slash_bits;
        std::string path = ninja_path_read(edge->env_, v.c_str(), &slash_bits);
        $state.AddIn(edge, path, slash_bits);
    }

    !edge->inputs_.empty() || fatal("build does not have any inputs");

    c = 0; for(auto const & v : *implicit_inputs) {
        uint64_t slash_bits;
        std::string path = ninja_path_read(edge->env_, v.c_str(), &slash_bits);
        $state.AddIn(edge, path, slash_bits);
        ++c;
    }

    edge->implicit_deps_ = c;

    edge->order_only_deps_ = 0;
}

NINJA_API void ninja_default_add(const char * x) {
    auto & $state = $ninja.state(); auto & $env = $ninja.env();

    std::string e;

    $state.AddDefault(ninja_path_read(&$env, x), &e) || fatal("%s", e.c_str());
}

static bool ninja_buildlog_opened = false;

NINJA_API void ninja_buildlog_open() {
    if(!ninja_buildlog_opened) {
        $ninja.main.OpenBuildLog() || fatal("failed to open build log");
        $ninja.main.OpenDepsLog() || fatal("failed to open deps log");

        ninja_buildlog_opened = true;
    }
}

NINJA_API void ninja_buildlog_close() {
    if(ninja_buildlog_opened) {
        $ninja.main.build_log_.Close(); $ninja.main.deps_log_.Close();

        ninja_buildlog_opened = false;
    }
}

static bool __exit_on_error = false;

NINJA_API void ninja_exit_on_error(bool b) {
    __exit_on_error = b;
}

NINJA_API int ninja_build(ninja_strings * targets) {
    // g_explaining = true;

    StatusPrinter status($ninja.config);

    std::vector<const char *> paths; {
        for(auto const & v : *targets) {
            paths.push_back(v.c_str());
        }
    }

    auto & main = $ninja.main;

    main.start_time_millis_ = GetTimeMillis();

    main.EnsureBuildDirExists() || fatal("failed to ensure build dir exists");

    ninja_buildlog_open();

    int rc = main.RunBuild(paths.size(), (char **)paths.data(), &status);

    if(rc > 0) {
        if(__exit_on_error) exit(rc);
    }

    return rc;

    // $ninja.main.DumpMetrics();
}

static std::string ninja_path_read(BindingEnv * env, const char * s, uint64_t * slash_bits) {
    EvalString es; ninja_evalstring_read(s, &es, true);

    std::string path = es.Evaluate(env); {
        !path.empty() || fatal("empty path");
    }

    uint64_t bits;

    CanonicalizePath(&path, slash_bits ? slash_bits : &bits);

    return path;
}

static bool ninja_evalstring_read(const char * s, EvalString * eval, bool path) {
    const char * p = s;
    const char * q;
    const char * start;
    for(;;) {
        start = p;
        {
            unsigned char yych;
            static const unsigned char yybm[] = {
                0, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 0, 16, 16, 0, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                32, 16, 16, 16, 0, 16, 16, 16,
                16, 16, 16, 16, 16, 208, 144, 16,
                208, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 0, 16, 16, 16, 16, 16,
                16, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 16, 16, 16, 16, 208,
                16, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 208, 208, 208, 208, 208,
                208, 208, 208, 16, 0, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
                16, 16, 16, 16, 16, 16, 16, 16,
            };
            yych = *p;
            if(yybm[0 + yych] & 16) {
                goto yy102;
            }
            if(yych <= '\r') {
                if(yych <= 0x00) goto yy100;
                if(yych <= '\n') goto yy105;
                goto yy107;
            } else {
                if(yych <= ' ') goto yy105;
                if(yych <= '$') goto yy109;
                goto yy105;
            }
        yy100:
            break;
        yy102:
            yych = *++p;
            if(yybm[0 + yych] & 16) {
                goto yy102;
            }
            {
                eval->AddText(StringPiece(start, p - start));
                continue;
            }
        yy105:
            ++p;
            {
                if(path) {
                    p = start;
                    break;
                } else {
                    if(*start == '\n')
                        break;
                    eval->AddText(StringPiece(start, 1));
                    continue;
                }
            }
        yy107:
            yych = *++p;
            if(yych == '\n') goto yy110;
            {
                fatal("bad eval string");
            }
        yy109:
            yych = *++p;
            if(yybm[0 + yych] & 64) {
                goto yy122;
            }
            if(yych <= ' ') {
                if(yych <= '\f') {
                    if(yych == '\n') goto yy114;
                    goto yy112;
                } else {
                    if(yych <= '\r') goto yy117;
                    if(yych <= 0x1F) goto yy112;
                    goto yy118;
                }
            } else {
                if(yych <= '/') {
                    if(yych == '$') goto yy120;
                    goto yy112;
                } else {
                    if(yych <= ':') goto yy125;
                    if(yych <= '`') goto yy112;
                    if(yych <= '{') goto yy127;
                    goto yy112;
                }
            }
        yy110:
            ++p;
            {
                if(path)
                    p = start;
                break;
            }
        yy112:
            ++p;
        yy113 : {
            fatal("bad $-escape (literal $ must be written as $$)");
        }
        yy114:
            yych = *++p;
            if(yybm[0 + yych] & 32) {
                goto yy114;
            }
            {
                continue;
            }
        yy117:
            yych = *++p;
            if(yych == '\n') goto yy128;
            goto yy113;
        yy118:
            ++p;
            {
                eval->AddText(StringPiece(" ", 1));
                continue;
            }
        yy120:
            ++p;
            {
                eval->AddText(StringPiece("$", 1));
                continue;
            }
        yy122:
            yych = *++p;
            if(yybm[0 + yych] & 64) {
                goto yy122;
            }
            {
                eval->AddSpecial(StringPiece(start + 1, p - start - 1));
                continue;
            }
        yy125:
            ++p;
            {
                eval->AddText(StringPiece(":", 1));
                continue;
            }
        yy127:
            yych = *(q = ++p);
            if(yybm[0 + yych] & 128) {
                goto yy131;
            }
            goto yy113;
        yy128:
            yych = *++p;
            if(yych == ' ') goto yy128;
            {
                continue;
            }
        yy131:
            yych = *++p;
            if(yybm[0 + yych] & 128) {
                goto yy131;
            }
            if(yych == '}') goto yy134;
            p = q;
            goto yy113;
        yy134:
            ++p;
            {
                eval->AddSpecial(StringPiece(start + 2, p - start - 3));
                continue;
            }
        }
    }
    // if(path) EatWhitespace();
    // Non-path strings end in newlines, so there's no whitespace to eat.
    return true;
}

NINJA_API void ninja_initialize() {
    new(&$ninja) ninja_runtime();
    ninja_var_set("builddir", DEFAULT_BUILD_DIR);
}

NINJA_API void ninja_finalize() {
    ninja_buildlog_close();
}
