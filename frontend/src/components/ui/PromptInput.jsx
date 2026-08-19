// src/components/ui/PromptInput.jsx
// Gradient-border prompt input — adapted to DocLens theme (CSS-in-JS, no Tailwind dependency).
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, WandSparkles, Paperclip, ArrowUp, X, Clock } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

/**
 * PromptInput — polished chat textarea with:
 *  - Animated gradient border (default = cyan/emerald, magic = rose/fuchsia)
 *  - Dismissible credits banner
 *  - Mic / Magic / Attach action buttons
 *  - Auto-growing textarea via react-textarea-autosize
 *  - Accessible loading state with spinner
 */
const PromptInput = React.forwardRef(
  ({ variant = "default", credits, onUpgrade, onSubmit, isLoading, className, ...props }, ref) => {
    const [showBanner, setShowBanner] = React.useState(credits !== undefined);

    const gradients = {
      default: "linear-gradient(135deg, rgba(52,211,153,0.8), rgba(6,182,212,0.8), rgba(99,102,241,0.7))",
      magic:   "linear-gradient(135deg, rgba(251,113,133,0.8), rgba(217,70,239,0.8), rgba(99,102,241,0.8))",
    };

    const actionButtons = React.useMemo(() => [
      { icon: Mic,          label: "Use Microphone" },
      { icon: WandSparkles, label: "Magic Tools" },
      { icon: Paperclip,    label: "Attach File" },
    ], []);

    return (
      <div
        className={className}
        style={{
          position: "relative",
          width: "100%",
          borderRadius: "16px",
          padding: "1.5px",
          background: gradients[variant] || gradients.default,
          boxShadow: variant === "magic"
            ? "0 0 28px rgba(217,70,239,0.2)"
            : "0 0 28px rgba(6,182,212,0.18)",
        }}
      >
        {/* Inner card */}
        <div style={{
          borderRadius: "14.5px",
          background: "rgba(9, 9, 15, 0.96)",
          backdropFilter: "blur(12px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}>

          {/* Credits banner */}
          <AnimatePresence>
            {showBanner && credits !== undefined && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "linear-gradient(90deg, rgba(251,146,60,0.08) 0%, rgba(52,211,153,0.05) 60%, transparent 100%)",
                  fontSize: "0.78rem",
                  fontFamily: "Inter, sans-serif",
                }}>
                  <span style={{ color: "rgba(234,250,241,0.5)" }}>
                    <strong style={{ color: "rgba(234,250,241,0.9)", fontWeight: 600 }}>{credits}</strong>
                    {" "}credits remaining
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <button
                      onClick={onUpgrade}
                      style={{
                        fontWeight: 600, fontSize: "0.75rem",
                        color: "#34d399", background: "none", border: "none",
                        cursor: "pointer", fontFamily: "Inter, sans-serif",
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={e => e.target.style.color = "#6ee7b7"}
                      onMouseLeave={e => e.target.style.color = "#34d399"}
                    >
                      Upgrade
                    </button>
                    <button
                      onClick={() => setShowBanner(false)}
                      aria-label="Dismiss banner"
                      style={{
                        display: "flex", alignItems: "center",
                        color: "rgba(234,250,241,0.35)", background: "none",
                        border: "none", cursor: "pointer", padding: 0,
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "rgba(234,250,241,0.7)"}
                      onMouseLeave={e => e.currentTarget.style.color = "rgba(234,250,241,0.35)"}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Textarea */}
          <div style={{ padding: "14px 16px 10px" }}>
            <TextareaAutosize
              ref={ref}
              minRows={1}
              maxRows={8}
              style={{
                width: "100%",
                resize: "none",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "rgba(234,250,241,0.9)",
                fontSize: "0.9rem",
                lineHeight: 1.65,
                fontFamily: "Inter, sans-serif",
                caretColor: "#06b6d4",
              }}
              {...props}
            />
          </div>

          {/* Toolbar */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px 12px",
          }}>
            {/* Left action icons */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              {actionButtons.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  aria-label={label}
                  disabled={isLoading}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, borderRadius: "8px",
                    background: "none", border: "none",
                    color: "rgba(234,250,241,0.3)",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    transition: "color 0.15s, background 0.15s",
                    opacity: isLoading ? 0.4 : 1,
                  }}
                  onMouseEnter={e => {
                    if (!isLoading) {
                      e.currentTarget.style.color = "#06b6d4";
                      e.currentTarget.style.background = "rgba(6,182,212,0.08)";
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = "rgba(234,250,241,0.3)";
                    e.currentTarget.style.background = "none";
                  }}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>

            {/* Submit button */}
            <button
              onClick={onSubmit}
              aria-label="Submit prompt"
              disabled={isLoading || !props.value}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: "50%",
                background: isLoading || !props.value
                  ? "rgba(255,255,255,0.07)"
                  : "linear-gradient(135deg, #06b6d4, #10b981)",
                border: "none",
                color: isLoading || !props.value ? "rgba(234,250,241,0.25)" : "#fff",
                cursor: isLoading || !props.value ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                boxShadow: isLoading || !props.value ? "none" : "0 4px 16px rgba(6,182,212,0.35)",
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                if (!isLoading && props.value) {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(6,182,212,0.5)";
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.boxShadow = isLoading || !props.value ? "none" : "0 4px 16px rgba(6,182,212,0.35)";
              }}
            >
              {isLoading ? (
                <div style={{
                  width: 15, height: 15,
                  border: "2px solid rgba(234,250,241,0.2)",
                  borderTopColor: "rgba(234,250,241,0.7)",
                  borderRadius: "50%",
                  animation: "prompt-spin 0.7s linear infinite",
                }} />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
        </div>
        <style>{`@keyframes prompt-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
);

PromptInput.displayName = "PromptInput";
export { PromptInput };
