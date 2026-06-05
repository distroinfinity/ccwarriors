import { useRef, useState } from "react";
import { API_HTTP } from "../../api";
import { tierAt } from "../../sponsorTiers";
import { PixelHeart } from "../PixelHeart";

type Phase = "idle" | "loading" | "paid";

// Razorpay's checkout.js, injected on first click only.
let scriptPromise: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error("checkout.js failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** Order → modal → verify. UPI/cards/netbanking via Razorpay Standard Checkout. */
export function RazorpayButton({
  tierIdx,
  onPaid,
}: {
  tierIdx: number;
  onPaid: () => void;
}) {
  const tier = tierAt(tierIdx);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const donate = async () => {
    setError(null);
    setPhase("loading");
    try {
      await loadCheckout();
      const orderRes = await fetch(`${API_HTTP}/donate/order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: tier.inr }),
      });
      if (!orderRes.ok) throw new Error(`order failed (${orderRes.status})`);
      const order: { orderId: string; amount: number; currency: string; keyId: string } =
        await orderRes.json();

      const name = nameRef.current?.value.trim().slice(0, 60) || undefined;
      const rzp = new window.Razorpay!({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount * 100,
        currency: order.currency,
        name: "CCWarriors",
        description: `${tier.name} tier · ${tier.copy}`,
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyRes = await fetch(`${API_HTTP}/donate/verify`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ...resp, name }),
            });
            if (!verifyRes.ok) throw new Error(`verify failed (${verifyRes.status})`);
            setPhase("paid");
            onPaid();
          } catch (err) {
            setPhase("idle");
            setError(err instanceof Error ? err.message : "verification failed");
          }
        },
        modal: {
          // User closed the modal — quiet reset, not an error.
          ondismiss: () => setPhase("idle"),
        },
        theme: { color: "#C2683E" },
      });
      rzp.on("payment.failed", () => {
        setPhase("idle");
        setError("Payment failed — nothing was charged. Try again?");
      });
      rzp.open();
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "something went wrong");
    }
  };

  if (phase === "paid") {
    return (
      <div className="donate-thanks">
        <PixelHeart /> Thank you, warrior. You're on the wall.
      </div>
    );
  }

  return (
    <div className="donate-rzp">
      <input
        ref={nameRef}
        className="donate-name"
        type="text"
        maxLength={60}
        placeholder="Name on the wall (optional)"
        aria-label="Name shown on the sponsor wall"
      />
      <button className="donate-cta" onClick={donate} disabled={phase === "loading"}>
        {phase === "loading" ? "Opening checkout…" : `Donate ₹${tier.inr.toLocaleString("en-IN")} · UPI / card`}
      </button>
      {error && <div className="donate-err">{error}</div>}
    </div>
  );
}
