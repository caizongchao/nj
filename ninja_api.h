#pragma once

#include <state.h>
#include <eval_env.h>
#include <build.h>
#include <clean.h>
#include <disk_interface.h>
#include <build_log.h>
#include <deps_log.h>
#include <status.h>
#include <metrics.h>
#include <util.h>
#include <debug_flags.h>

struct NinjaMain : public BuildLogUser {
    /// Command line used to run Ninja.
    const char * ninja_command_;

    /// Build configuration set from flags (e.g. parallelism).
    const BuildConfig & config_;

    /// Loaded state (rules, nodes).
    State state_;

    /// Functions for accessing the disk.
    RealDiskInterface disk_interface_;

    /// The build directory, used for storing the build log etc.
    std::string build_dir_;

    BuildLog build_log_;
    DepsLog deps_log_;

    int64_t start_time_millis_;

    NinjaMain(const char * ninja_command, const BuildConfig & config);

    /// Get the Node for a given command-line path, handling features like
    /// spell correction.
    Node * CollectTarget(const char * cpath, std::string * err);

    /// CollectTarget for all command-line arguments, filling in \a targets.
    bool CollectTargetsFromArgs(int argc, char * argv[],
        std::vector<Node *> * targets, std::string * err);

    /// Open the build log.
    /// @return false on error.
    bool OpenBuildLog(bool recompact_only = false);

    /// Open the deps log: load it, then open for writing.
    /// @return false on error.
    bool OpenDepsLog(bool recompact_only = false);

    /// Ensure the build directory exists, creating it if necessary.
    /// @return false on error.
    bool EnsureBuildDirExists();

    /// Rebuild the manifest, if necessary.
    /// Fills in \a err on error.
    /// @return true if the manifest was rebuilt.
    bool RebuildManifest(const char * input_file, std::string * err, Status * status);

    /// Build the targets listed on the command line.
    /// @return an exit code.
    int RunBuild(int argc, char ** argv, Status * status);

    /// Dump the output requested by '-d stats'.
    void DumpMetrics();

    virtual bool IsPathDead(StringPiece s) const;
};

struct ninja_runtime {
    BuildConfig config;
    NinjaMain main;
    StatusPrinter status;

    State & state() { return main.state_; }
    BindingEnv & env() { return state().bindings_; }
    
    ninja_runtime();
};

extern "C" ninja_runtime $ninja;

#ifdef NINJA_BUILD_LIB
#    define NINJA_API
#else
#    ifdef NINJA_BUILD_SHARED
#        ifdef _WIN32
#            define NINJA_API __declspec(dllexport)
#        else
#            define NINJA_API __attribute__((visibility("default")))
#        endif
#    else
#        ifdef _WIN32
#            define NINJA_API __declspec(dllimport)
#        else
#            define NINJA_API
#        endif
#    endif
#endif

typedef std::vector<std::string> ninja_strings;
typedef std::map<std::string, std::string> ninja_string_map;

extern "C" {
NINJA_API void ninja_initialize();
NINJA_API void ninja_finalize();
NINJA_API void * ninja_strings_new();
NINJA_API void ninja_strings_free(void * v);
NINJA_API void ninja_strings_add(void * v, const char * s);
NINJA_API void * ninja_string_map_new();
NINJA_API void ninja_string_map_free(void * x);
NINJA_API void ninja_string_map_add(void * x, const char * k, const char * v);
NINJA_API void ninja_reset();
NINJA_API void ninja_clear();
NINJA_API void ninja_clean();
NINJA_API const char * ninja_var_get(const char * key);
NINJA_API void ninja_var_set(const char * key, const char * value);
NINJA_API void ninja_pool_add(const char * name, int depth);
NINJA_API void * ninja_rule_new(const char * name);
NINJA_API void ninja_rule_var_add(Rule * r, const char * key, const char * val);
NINJA_API void * ninja_rule_make(const char * name, ninja_string_map * vars);
NINJA_API void ninja_edge_add(const char * rule_name, ninja_strings * outputs, ninja_strings * implicit_outputs, ninja_strings * inputs, ninja_strings * implicit_inputs, ninja_string_map * vars);
NINJA_API void ninja_default_add(const char * x);
NINJA_API void ninja_buildlog_open();
NINJA_API void ninja_buildlog_close();
NINJA_API void ninja_exit_on_error(bool b);
NINJA_API int ninja_build(ninja_strings * targets);
}