#include <jni.h>
#include <android/log.h>

#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"
#include "ggml-backend.h"
#include "ggml-cpu.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstring>
#include <fstream>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

namespace {
constexpr const char * TAG = "PumpRcaLocalAI";
constexpr int32_t N_CTX = 4096;
constexpr int32_t N_BATCH = 512;
constexpr int32_t VISION_MAX_TOKENS = 160;
constexpr int32_t RCA_MAX_TOKENS = 1024;
constexpr int32_t CHAT_MAX_TOKENS = 256;
constexpr auto MAX_INFERENCE_TIME = std::chrono::minutes(12);
std::atomic<bool> cancel_requested{false};

struct NativeLog {
    std::string text;
};

std::mutex native_file_mutex;
std::string memory_report();

void reset_native_file() {
    std::lock_guard<std::mutex> lock(native_file_mutex);
    constexpr const char * path = "/data/data/com.app.pumprcamobile/files/pumprca-native.log";
    std::ofstream out(path, std::ios::trunc);
    out << "NATIVE_LOG_START memory=" << memory_report() << "\n";
}

void append_native_file(const std::string & text) {
    std::lock_guard<std::mutex> lock(native_file_mutex);
    constexpr const char * path = "/data/data/com.app.pumprcamobile/files/pumprca-native.log";
    std::ofstream out(path, std::ios::app);
    if (!out.good()) return;
    out << text;
    out.flush();
}

std::string memory_report() {
    std::ifstream status("/proc/self/status");
    std::string line;
    std::ostringstream out;
    while (std::getline(status, line)) {
        if (line.rfind("VmRSS:", 0) == 0 || line.rfind("VmHWM:", 0) == 0 ||
            line.rfind("VmSize:", 0) == 0 || line.rfind("VmPeak:", 0) == 0) {
            out << line << " ";
        }
    }
    return out.str().empty() ? "memory=unavailable" : out.str();
}

void stage_log(NativeLog & log, const char * stage, const std::string & detail) {
    const std::string line = std::string("STAGE=") + stage + " " + detail + " " + memory_report() + "\n";
    log.text += line;
    append_native_file(line);
    __android_log_print(ANDROID_LOG_INFO, TAG, "%s", line.c_str());
}

void native_log(enum ggml_log_level level, const char * text, void * user_data) {
    auto * log = static_cast<NativeLog *>(user_data);
    if (log && text) {
        log->text += text;
        if (log->text.size() > 24000) log->text.erase(0, log->text.size() - 24000);
    }
    if (text) append_native_file(text);
    __android_log_print(level >= GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO,
                        TAG, "%s", text ? text : "");
}

struct InferenceControl {
    std::chrono::steady_clock::time_point deadline;
    InferenceControl() : deadline(std::chrono::steady_clock::now() + MAX_INFERENCE_TIME) {
        cancel_requested.store(false, std::memory_order_relaxed);
    }
    bool stopped() const {
        return cancel_requested.load(std::memory_order_relaxed) ||
               std::chrono::steady_clock::now() >= deadline;
    }
    const char * stop_reason() const {
        return cancel_requested.load(std::memory_order_relaxed) ? "CANCELLED" : "TIMEOUT_12_MIN";
    }
};

bool abort_decode(void * data) {
    return static_cast<InferenceControl *>(data)->stopped();
}
bool continue_loading(float, void * data) {
    return !static_cast<InferenceControl *>(data)->stopped();
}

struct ProgressSink {
    JNIEnv * env;
    jobject callback;
    jmethodID on_phase;
    ProgressSink(JNIEnv * e, jobject cb) : env(e), callback(cb), on_phase(nullptr) {
        if (cb) {
            jclass cls = env->GetObjectClass(cb);
            on_phase = env->GetMethodID(cls, "onPhase", "(Ljava/lang/String;)V");
            env->DeleteLocalRef(cls);
            if (env->ExceptionCheck()) env->ExceptionClear();
        }
    }
    void send(const char * phase) const {
        __android_log_print(ANDROID_LOG_INFO, TAG, "phase=%s", phase);
        if (!callback || !on_phase) return;
        jstring value = env->NewStringUTF(phase);
        if (value) {
            env->CallVoidMethod(callback, on_phase, value);
            env->DeleteLocalRef(value);
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
    }
};

std::string file_report(const std::string & path) {
    struct stat st{};
    std::ostringstream out;
    out << "path=" << path;
    if (stat(path.c_str(), &st) != 0) return out.str() + " exists=false";
    out << " exists=true size_bytes=" << static_cast<long long>(st.st_size) << " readable=";
    std::ifstream file(path, std::ios::binary);
    char magic[4]{};
    const bool readable = file.good() && static_cast<bool>(file.read(magic, sizeof(magic)));
    out << (readable ? "true" : "false") << " magic=";
    out.write(magic, sizeof(magic));
    return out.str();
}

bool is_gguf(const std::string & path) {
    std::ifstream file(path, std::ios::binary);
    char magic[4]{};
    return file.good() && static_cast<bool>(file.read(magic, sizeof(magic))) &&
           std::memcmp(magic, "GGUF", sizeof(magic)) == 0;
}

struct BackendStatus {
    bool cpu = false;
    std::string names;
};

BackendStatus init_backends() {
    llama_backend_init();
    if (ggml_backend_reg_by_name("CPU") == nullptr) {
        ggml_backend_register(ggml_backend_cpu_reg());
    }
    ggml_backend_load_all();
    BackendStatus status;
    for (size_t i = 0; i < ggml_backend_reg_count(); ++i) {
        const auto reg = ggml_backend_reg_get(i);
        const char * name = ggml_backend_reg_name(reg);
        if (!name) continue;
        if (!status.names.empty()) status.names += ",";
        status.names += name;
        if (std::strcmp(name, "CPU") == 0) status.cpu = true;
    }
    return status;
}

std::string backend_report(const BackendStatus & status) {
    return std::string("BACKEND_INIT_OK=") + (status.cpu ? "true" : "false") +
           " CPU_BACKEND_LOADED=" + (status.cpu ? "true" : "false") +
           " BACKENDS=" + (status.names.empty() ? "<none>" : status.names);
}

struct NativeSession {
    NativeLog log;
    BackendStatus backends;
    NativeSession() {
        reset_native_file();
        llama_log_set(native_log, &log);
        mtmd_helper_log_set(native_log, &log);
        backends = init_backends();
        log.text += backend_report(backends) + "\n";
        append_native_file("\n=== NATIVE_SESSION_START ===\n" + backend_report(backends) + "\n" + memory_report() + "\n");
    }
    ~NativeSession() {
        append_native_file("=== NATIVE_SESSION_END === " + memory_report() + "\n");
        llama_backend_free();
        mtmd_helper_log_set(nullptr, nullptr);
        llama_log_set(nullptr, nullptr); // global logger must not retain a pointer to freed stack storage
    }
};

std::string error_report(const char * family, const char * stage, int code,
                         const std::string & path, const NativeSession & session,
                         const std::string & detail = {}) {
    std::ostringstream out;
    out << family << " stage=" << stage << " code=" << code << " " << file_report(path)
        << " detail=" << detail << "\n" << backend_report(session.backends)
        << "\nNATIVE_LOG_BEGIN\n" << session.log.text << "\nNATIVE_LOG_END";
    append_native_file("ERROR family=" + std::string(family) + " stage=" + stage +
                       " return_code=" + std::to_string(code) + " " + file_report(path) +
                       " detail=" + detail + " " + memory_report() + "\n");
    return out.str();
}

std::string model_report(const std::string & path, const llama_model * model,
                         const llama_context * ctx) {
    std::ostringstream out;
    out << "MODEL_PATH=" << path
        << "\nRUNTIME=llama.cpp+libmtmd"
        << "\nEXECUTION_PROVIDER=ggml-cpu"
        << "\nMODEL_CONTEXT=" << (ctx ? llama_n_ctx(ctx) : 0)
        << "\nMODEL_CHAT_TEMPLATE=";
    if (model) {
        const char * templ = llama_model_chat_template(model, nullptr);
        out << (templ ? templ : "<none>");
    } else {
        out << "<not_loaded>";
    }
    out << "\nINPUT_TENSORS=llama_batch(token:int32,pos:int32,seq_id:int32,logits:int8);mtmd_bitmap(image:jpeg->rgb)"
        << "\nINPUT_SHAPES=dynamic_tokens;image_max_tokens=1024"
        << "\nINPUT_TYPES=GGUF/token:int32/image:RGB";
    return out.str();
}

jstring reply(JNIEnv * env, const std::string & text) {
    return env->NewStringUTF(text.c_str());
}

std::string jstring_to_utf8(JNIEnv * env, jstring value) {
    if (!value) return {};
    const char * raw = env->GetStringUTFChars(value, nullptr);
    std::string result = raw ? raw : "";
    if (raw) env->ReleaseStringUTFChars(value, raw);
    return result;
}

std::string token_piece(const llama_vocab * vocab, llama_token token) {
    char buffer[512];
    int32_t n = llama_token_to_piece(vocab, token, buffer, sizeof(buffer), 0, true);
    if (n < 0) {
        std::string large(static_cast<size_t>(-n), '\0');
        n = llama_token_to_piece(vocab, token, large.data(), static_cast<int32_t>(large.size()), 0, true);
        return n > 0 ? large.substr(0, static_cast<size_t>(n)) : std::string{};
    }
    return n > 0 ? std::string(buffer, static_cast<size_t>(n)) : std::string{};
}

std::vector<llama_token> tokenize(const llama_vocab * vocab, const std::string & text) {
    std::vector<llama_token> tokens(2048);
    int32_t n = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()),
                               tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    if (n < 0) {
        tokens.resize(static_cast<size_t>(-n));
        n = llama_tokenize(vocab, text.data(), static_cast<int32_t>(text.size()),
                           tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    }
    if (n < 0) return {};
    tokens.resize(static_cast<size_t>(n));
    return tokens;
}

// llama_batch_init ALLOCATES capacity, but explicitly sets batch.n_tokens = 0.
// The previous implementation filled fields without assigning n_tokens, so every
// Qwen3 prompt passed an empty batch to llama_decode (prompt_decode_failed).
int decode_text(llama_context * ctx, const std::vector<llama_token> & tokens,
                llama_pos & position, const InferenceControl & control) {
    for (size_t offset = 0; offset < tokens.size(); offset += N_BATCH) {
        if (control.stopped()) return 2;
        const int32_t count = static_cast<int32_t>(std::min<size_t>(N_BATCH, tokens.size() - offset));
        if (position + count > static_cast<llama_pos>(llama_n_ctx(ctx))) return -2;
        llama_batch batch = llama_batch_init(count, 0, 1);
        batch.n_tokens = count;
        for (int32_t i = 0; i < count; ++i) {
            batch.token[i] = tokens[offset + i];
            batch.pos[i] = position + i;
            batch.n_seq_id[i] = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i] = (offset + i + 1 == tokens.size()) ? 1 : 0;
        }
        const int result = llama_decode(ctx, batch);
        llama_batch_free(batch);
        if (result != 0) return result;
        position += count;
    }
    return 0;
}

int decode_next(llama_context * ctx, llama_token token, llama_pos & position) {
    if (position >= static_cast<llama_pos>(llama_n_ctx(ctx))) return -2;
    llama_seq_id seq = 0;
    llama_seq_id * seq_ptr = &seq;
    int32_t n_seq_id = 1;
    int8_t logits = 1;
    llama_batch batch{1, &token, nullptr, &position, &n_seq_id, &seq_ptr, &logits};
    const int result = llama_decode(ctx, batch);
    if (result == 0) ++position;
    return result;
}

struct Generation {
    std::string text;
    int code = 0; // 0: EOG; 2: cancelled/time limit; 3: output cap; -2: context full; other: decode return
    int generated_tokens = 0;
};

Generation generate(llama_context * ctx, const llama_vocab * vocab, llama_pos & position,
                    int max_tokens, const InferenceControl & control) {
    Generation result;
    using Sampler = std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)>;
    Sampler sampler(llama_sampler_init_greedy(), llama_sampler_free);
    if (!sampler) { result.code = -3; return result; }
    for (int i = 0; i < max_tokens; ++i) {
        if (control.stopped()) { result.code = 2; return result; }
        const llama_token token = llama_sampler_sample(sampler.get(), ctx, -1);
        llama_sampler_accept(sampler.get(), token);
        if (llama_vocab_is_eog(vocab, token)) return result;
        result.text += token_piece(vocab, token);
        result.generated_tokens++;
        const int decode_result = decode_next(ctx, token, position);
        if (decode_result != 0) { result.code = decode_result; return result; }
    }
    result.code = 3; // Never claim a truncated report or image description is complete.
    return result;
}
} // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_example_llama_VisionPocBridge_nativeCancel(JNIEnv *, jclass) {
    cancel_requested.store(true, std::memory_order_relaxed);
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_llama_VisionPocBridge_nativeRunVisionPoc(
        JNIEnv * env, jclass, jstring jModelPath, jstring jMmprojPath,
        jbyteArray jImageBytes, jobject jProgress) {
    const std::string model_path = jstring_to_utf8(env, jModelPath);
    const std::string mmproj_path = jstring_to_utf8(env, jMmprojPath);
    if (model_path.empty() || mmproj_path.empty() || !jImageBytes) {
        return reply(env, "VISION_ERROR stage=INPUT code=-1 vision GGUF, mmproj, image required");
    }
    const jsize image_size = env->GetArrayLength(jImageBytes);
    if (image_size <= 0 || image_size > 12 * 1024 * 1024) {
        return reply(env, "VISION_ERROR stage=INPUT code=-1 image JPEG empty or over 12 MB");
    }
    std::vector<unsigned char> image(static_cast<size_t>(image_size));
    env->GetByteArrayRegion(jImageBytes, 0, image_size, reinterpret_cast<jbyte *>(image.data()));
    if (env->ExceptionCheck()) return nullptr;
    InferenceControl control;
    ProgressSink progress(env, jProgress);
    NativeSession session;
    session.log.text += "INFERENCE_START=vision\n" + model_report(model_path, nullptr, nullptr) + "\n";
    if (!session.backends.cpu) return reply(env, error_report("VISION_ERROR", "BACKEND_INIT", -1, model_path, session));
    if (!is_gguf(model_path)) return reply(env, error_report("VISION_ERROR", "GGUF_FILE", -1, model_path, session, "expected GGUF magic"));
    if (!is_gguf(mmproj_path)) return reply(env, error_report("VISION_ERROR", "MMPROJ_FILE", -1, mmproj_path, session, "expected GGUF magic"));

    using Model = std::unique_ptr<llama_model, decltype(&llama_model_free)>;
    using Context = std::unique_ptr<llama_context, decltype(&llama_free)>;
    using Vision = std::unique_ptr<mtmd_context, decltype(&mtmd_free)>;
    using Bitmap = std::unique_ptr<mtmd_bitmap, decltype(&mtmd_bitmap_free)>;
    using Chunks = std::unique_ptr<mtmd_input_chunks, decltype(&mtmd_input_chunks_free)>;
    progress.send("VISION_MODEL_LOAD");
    stage_log(session.log, "llama_model_load.START", "path=" + model_path + " " + file_report(model_path));
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    model_params.progress_callback = continue_loading;
    model_params.progress_callback_user_data = &control;
    Model model(llama_model_load_from_file(model_path.c_str(), model_params), llama_model_free);
    stage_log(session.log, "llama_model_load.RESULT", std::string("ok=") + (model ? "true" : "false"));
    if (!model) return reply(env, error_report("VISION_ERROR", "VISION_MODEL_LOAD", -1, model_path, session, control.stopped() ? control.stop_reason() : "llama_model_load_from_file returned null"));

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = N_CTX;
    context_params.n_batch = N_BATCH;
    context_params.n_ubatch = 128;
    context_params.n_threads = 4;
    context_params.n_threads_batch = 4;
    context_params.abort_callback = abort_decode;
    context_params.abort_callback_data = &control;
    stage_log(session.log, "llama_init_from_model.START", "n_ctx=" + std::to_string(N_CTX) + " n_batch=" + std::to_string(N_BATCH) + " threads=4");
    Context ctx(llama_init_from_model(model.get(), context_params), llama_free);
    stage_log(session.log, "llama_init_from_model.RESULT", std::string("ok=") + (ctx ? "true" : "false"));
    if (!ctx) return reply(env, error_report("VISION_ERROR", "VISION_CONTEXT_LOAD", -1, model_path, session, "llama_init_from_model returned null"));
    session.log.text += model_report(model_path, model.get(), ctx.get()) + "\n";

    progress.send("MMPROJ_LOAD");
    mtmd_context_params vision_params = mtmd_context_params_default();
    vision_params.use_gpu = false;
    vision_params.n_threads = 4;
    vision_params.print_timings = false;
    vision_params.image_max_tokens = 1024;
    vision_params.progress_callback = continue_loading;
    vision_params.progress_callback_user_data = &control;
    stage_log(session.log, "mtmd_init.START", "path=" + mmproj_path + " " + file_report(mmproj_path));
    Vision vision(mtmd_init_from_file(mmproj_path.c_str(), model.get(), vision_params), mtmd_free);
    stage_log(session.log, "mtmd_init.RESULT", std::string("ok=") + (vision ? "true" : "false"));
    if (!vision) return reply(env, error_report("VISION_ERROR", "MMPROJ_LOAD", -1, mmproj_path, session, control.stopped() ? control.stop_reason() : "mtmd_init_from_file returned null"));
    if (!mtmd_support_vision(vision.get())) return reply(env, error_report("VISION_ERROR", "MMPROJ_VISION_CAPABILITY", -1, mmproj_path, session));

    progress.send("IMAGE_DECODE");
    mtmd_helper_init_opt init_opt = mtmd_helper_init_opt_default();
    const auto wrapped = mtmd_helper_bitmap_init_from_buf(vision.get(), image.data(), image.size(), false, init_opt);
    Bitmap bitmap(wrapped.bitmap, mtmd_bitmap_free);
    if (!bitmap) return reply(env, error_report("VISION_ERROR", "IMAGE_DECODE", -1, model_path, session, "bitmap decode failed"));

    // The bitmap is an actual media chunk; never infer visual contents from file name or metadata.
    const std::string prompt =
        "<|im_start|>user\n<__media__>\n"
        "Describe what is visibly present in this image in two short sentences. "
        "Mention objects and any visible damage; do not infer unseen causes."
        "<|im_end|>\n<|im_start|>assistant\n";
    mtmd_input_text input_text{prompt.data(), prompt.size(), true, true};
    const mtmd_bitmap * bitmaps[] = {bitmap.get()};
    Chunks chunks(mtmd_input_chunks_init(), mtmd_input_chunks_free);
    progress.send("MTMD_TOKENIZE");
    stage_log(session.log, "mtmd_tokenize.START", "image_bytes=" + std::to_string(image.size()));
    const int tokenize_result = mtmd_tokenize(vision.get(), chunks.get(), &input_text, bitmaps, 1);
    stage_log(session.log, "mtmd_tokenize.RESULT", "return_code=" + std::to_string(tokenize_result));
    if (tokenize_result != 0) return reply(env, error_report("VISION_ERROR", "MTMD_TOKENIZE", tokenize_result, model_path, session, "bitmap was not accepted by libmtmd"));
    const auto visual_positions = mtmd_helper_get_n_pos(chunks.get());
    if (visual_positions + VISION_MAX_TOKENS + 8 >= N_CTX) {
        return reply(env, error_report("VISION_ERROR", "IMAGE_CONTEXT_FULL", -2, model_path, session, "image positions=" + std::to_string(visual_positions) + " context=" + std::to_string(N_CTX)));
    }
    llama_pos position = 0;
    progress.send("MTMD_EVAL");
    stage_log(session.log, "mtmd_eval.START", "visual_positions=" + std::to_string(visual_positions) + " n_batch=" + std::to_string(N_BATCH));
    const int eval_result = mtmd_helper_eval_chunks(vision.get(), ctx.get(), chunks.get(), 0, 0, N_BATCH, true, &position);
    stage_log(session.log, "mtmd_eval.RESULT", "return_code=" + std::to_string(eval_result) + " position=" + std::to_string(position));
    if (eval_result != 0) return reply(env, error_report("VISION_ERROR", "MTMD_EVAL", eval_result, model_path, session, control.stopped() ? control.stop_reason() : "image encode/decode failed"));
    progress.send("VISION_GENERATE");
    const auto answer = generate(ctx.get(), llama_model_get_vocab(model.get()), position, VISION_MAX_TOKENS, control);
    if (answer.code != 0 || answer.text.empty()) {
        return reply(env, error_report("VISION_ERROR", "VISION_GENERATE", answer.code, model_path, session,
            std::string(control.stopped() ? control.stop_reason() : "generation failed, empty, or incomplete") +
            " generated_tokens=" + std::to_string(answer.generated_tokens)));
    }
    // All vision resources are scoped to this call. Kotlin invokes Qwen3 only
    // after this function returns; we no longer reload Qwen3 for every frame.
    session.log.text += "INFERENCE_END=vision success=true generated_tokens=" + std::to_string(answer.generated_tokens) + "\n";
    progress.send("VISION_UNLOAD");
    return reply(env, "VISION_POC_OK\n" + backend_report(session.backends) +
                      "\nVISION_MODEL_LOADED=true\nMMPROJ_LOADED=true\nBITMAP=decoded_and_encoded\nVISION_ANSWER=" +
                      answer.text + "\nVISION_UNLOADED=true");
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_example_llama_VisionPocBridge_nativeRunTextRca(
        JNIEnv * env, jclass, jstring jQwen3Path, jstring jPrompt, jobject jProgress) {
    const std::string model_path = jstring_to_utf8(env, jQwen3Path);
    const std::string prompt = jstring_to_utf8(env, jPrompt);
    if (model_path.empty() || prompt.empty()) return reply(env, "TEXT_RCA_ERROR stage=INPUT code=-1 Qwen3 GGUF and prompt required");
    InferenceControl control;
    ProgressSink progress(env, jProgress);
    NativeSession session;
    session.log.text += "INFERENCE_START=text_rca\n" + model_report(model_path, nullptr, nullptr) +
                        "\nPROMPT_BYTES=" + std::to_string(prompt.size()) + "\n";
    if (!session.backends.cpu) return reply(env, error_report("TEXT_RCA_ERROR", "BACKEND_INIT", -1, model_path, session));
    if (!is_gguf(model_path)) return reply(env, error_report("TEXT_RCA_ERROR", "GGUF_FILE", -1, model_path, session, "expected GGUF magic"));

    using Model = std::unique_ptr<llama_model, decltype(&llama_model_free)>;
    using Context = std::unique_ptr<llama_context, decltype(&llama_free)>;
    progress.send("QWEN3_LOAD");
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    model_params.progress_callback = continue_loading;
    model_params.progress_callback_user_data = &control;
    Model model(llama_model_load_from_file(model_path.c_str(), model_params), llama_model_free);
    if (!model) return reply(env, error_report("TEXT_RCA_ERROR", "QWEN3_LOAD", -1, model_path, session, control.stopped() ? control.stop_reason() : "llama_model_load_from_file returned null"));
    llama_context_params params = llama_context_default_params();
    params.n_ctx = N_CTX;
    params.n_batch = N_BATCH;
    params.n_ubatch = 128;
    params.n_threads = 4;
    params.n_threads_batch = 4;
    params.abort_callback = abort_decode;
    params.abort_callback_data = &control;
    progress.send("QWEN3_CONTEXT");
    Context ctx(llama_init_from_model(model.get(), params), llama_free);
    if (!ctx) return reply(env, error_report("TEXT_RCA_ERROR", "QWEN3_CONTEXT", -1, model_path, session, "llama_init_from_model returned null"));
    session.log.text += model_report(model_path, model.get(), ctx.get()) + "\n";

    const char * chat_template = llama_model_chat_template(model.get(), nullptr);
    const std::string user_message = prompt + "\n/no_think";
    const llama_chat_message message[] = {{"user", user_message.c_str()}};
    const int32_t needed = chat_template ? llama_chat_apply_template(chat_template, message, 1, true, nullptr, 0) : -1;
    if (needed <= 0) return reply(env, error_report("TEXT_RCA_ERROR", "CHAT_TEMPLATE", needed, model_path, session, "Qwen3 template unavailable"));
    std::string formatted_prompt(static_cast<size_t>(needed) + 1, '\0');
    const int32_t written = llama_chat_apply_template(chat_template, message, 1, true, formatted_prompt.data(), static_cast<int32_t>(formatted_prompt.size()));
    if (written <= 0 || written > needed) return reply(env, error_report("TEXT_RCA_ERROR", "CHAT_TEMPLATE", written, model_path, session, "prompt formatting failed"));
    formatted_prompt.resize(static_cast<size_t>(written));

    progress.send("PROMPT_TOKENIZE");
    auto tokens = tokenize(llama_model_get_vocab(model.get()), formatted_prompt);
    if (tokens.empty()) return reply(env, error_report("TEXT_RCA_ERROR", "PROMPT_TOKENIZE", -1, model_path, session));
    const bool is_chat = prompt.find("локальный инженерный RCA-чат") != std::string::npos;
    const int max_tokens = is_chat ? CHAT_MAX_TOKENS : RCA_MAX_TOKENS;
    if (tokens.size() + max_tokens + 8 >= llama_n_ctx(ctx.get())) {
        return reply(env, error_report("TEXT_RCA_ERROR", "PROMPT_TOO_LONG", -2, model_path, session,
             "prompt_tokens=" + std::to_string(tokens.size()) + " output_reserved=" +
             std::to_string(max_tokens) + " context=" + std::to_string(llama_n_ctx(ctx.get())) +
             "; reduce evidence/frames"));
    }
    llama_pos position = 0;
    progress.send("PROMPT_DECODE");
    stage_log(session.log, "llama_decode.START", "prompt_tokens=" + std::to_string(tokens.size()) + " n_batch=" + std::to_string(N_BATCH) + " n_ctx=" + std::to_string(N_CTX));
    const int decode_result = decode_text(ctx.get(), tokens, position, control);
    stage_log(session.log, "llama_decode.RESULT", "return_code=" + std::to_string(decode_result) + " position=" + std::to_string(position));
    if (decode_result != 0) {
        return reply(env, error_report("TEXT_RCA_ERROR", "QWEN3_INFERENCE", decode_result, model_path, session,
            std::string(control.stopped() ? control.stop_reason() : "prompt_decode_failed") +
            " prompt_tokens=" + std::to_string(tokens.size()) +
            " n_batch=" + std::to_string(N_BATCH) + " n_ctx=" + std::to_string(N_CTX) +
            " pos=" + std::to_string(position)));
    }
    progress.send("QWEN3_GENERATE");
    const auto answer = generate(ctx.get(), llama_model_get_vocab(model.get()), position, max_tokens, control);
    if (answer.code != 0 || answer.text.empty()) {
        return reply(env, error_report("TEXT_RCA_ERROR", "QWEN3_GENERATE", answer.code, model_path, session,
            std::string(control.stopped() ? control.stop_reason() : "generation failed, empty, or incomplete") +
            " generated_tokens=" + std::to_string(answer.generated_tokens) +
            " max_tokens=" + std::to_string(max_tokens)));
    }
    session.log.text += "INFERENCE_END=text_rca success=true generated_tokens=" + std::to_string(answer.generated_tokens) + "\n";
    progress.send("QWEN3_UNLOAD");
    return reply(env, "TEXT_RCA_OK\n" + backend_report(session.backends) +
                      "\nPROMPT_TOKENS=" + std::to_string(tokens.size()) +
                      "\nGENERATED_TOKENS=" + std::to_string(answer.generated_tokens) +
                      "\nANSWER=" + answer.text);
}
