import { ImageResponse } from "next/og";

export const alt = "Stablecoin Policy Tracker — Web3Law Intelligence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLORS = {
  bg: "#FAFAF8",
  card: "#FFFFFF",
  ink: "#1D1D1F",
  muted: "#86868B",
  hairline: "rgba(0, 0, 0, 0.08)",
  favorable: "#7EBC8E",
  review: "#D9C980",
  concerning: "#D9A766",
  restrictive: "#D98080",
};

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: COLORS.bg,
          display: "flex",
          flexDirection: "column",
          padding: 80,
          fontFamily: "sans-serif",
          color: COLORS.ink,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 24,
            color: COLORS.muted,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: COLORS.favorable,
            }}
          />
          Web3Law Intelligence
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: 48,
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 96,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: -2,
            }}
          >
            Stablecoin Policy
          </div>
          <div
            style={{
              fontSize: 96,
              lineHeight: 1.05,
              fontWeight: 700,
              letterSpacing: -2,
              color: COLORS.muted,
            }}
          >
            Tracker
          </div>
        </div>

        <div
          style={{
            marginTop: 48,
            fontSize: 32,
            color: COLORS.ink,
            maxWidth: 900,
            lineHeight: 1.4,
          }}
        >
          154 bills across US federal, US states, EU, and Asia-Pacific — with
          official-source updates, evidence, and jurisdiction coverage.
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 32,
            borderTop: `1px solid ${COLORS.hairline}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 24,
              color: COLORS.muted,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: COLORS.favorable,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: COLORS.review,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: COLORS.concerning,
              }}
            />
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: COLORS.restrictive,
              }}
            />
            <span style={{ marginLeft: 8 }}>Stance spectrum</span>
          </div>

          <div style={{ fontSize: 24, color: COLORS.ink, fontWeight: 600 }}>
            policy.citely.info
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
