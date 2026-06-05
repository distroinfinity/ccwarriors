// Legal — terms, privacy, refunds, contact. Written like the README and /how.
// Short sentences. One column. No legalese where plain words do the job.

const GH = "https://github.com/distroinfinity/ccwarriors";
const MAIL = "manurajput2911@gmail.com";

export function Legal() {
  return (
    <div className="how">
      <div className="seclabel">Legal</div>
      <h1 className="how-h">The boring pages, kept short.</h1>

      <section className="how-sec">
        <h2>Who we are</h2>
        <p>
          CCWarriors is a leaderboard for developers who use AI coding tools. It shows who
          burns the most tokens. It is free, it is{" "}
          <a href={GH} target="_blank" rel="noopener">
            open source
          </a>
          , and it is built for the developer community. It is run by{" "}
          <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
            Manu
          </a>{" "}
          from India.
        </p>
      </section>

      <section className="how-sec">
        <h2>Terms of use</h2>
        <p>
          The board, the CLI, and the API come as they are. No warranty. The service can go
          down. Keep your numbers honest. Numbers that cannot be real come off the board
          until a human looks. We can remove rows that abuse the service. Joining costs
          nothing and you can <a href="/how">leave anytime</a>.
        </p>
      </section>

      <section className="how-sec">
        <h2>Privacy</h2>
        <p>
          We store your GitHub login, your avatar, and your token counts per tool per day.
          We never see your code, your prompts, or your file names.{" "}
          <a href="/how">How it works</a> walks through the whole pipeline. We do not sell
          data. We do not run ads. Want your row gone? Email us and it gets deleted.
        </p>
      </section>

      <section className="how-sec">
        <h2>Sponsorships and pricing</h2>
        <p>
          Sponsoring is voluntary. It funds the servers. Tiers run from ₹400 to ₹25,600 on
          UPI and cards, or $4 to $256 on GitHub Sponsors. You get your name on the{" "}
          <a href="/#sponsor">sponsor wall</a>. Nothing ships. Card and UPI payments are
          processed by Razorpay. We never see your card or UPI details. We store the order
          id, the amount, and the name you choose for the wall.
        </p>
      </section>

      <section className="how-sec">
        <h2>Refunds and cancellation</h2>
        <p>
          Wrong amount, double charge, or your name never showed on the wall? Email us
          within 7 days and we refund you. Refunds go back to the original payment method
          in 5 to 7 working days. A sponsorship here is a single charge, so there is
          nothing to cancel. Monthly GitHub sponsorships are managed on GitHub and can be
          stopped there anytime.
        </p>
      </section>

      <section className="how-sec">
        <h2>Contact</h2>
        <p>
          Email <a href={`mailto:${MAIL}`}>{MAIL}</a>. Or open an issue on{" "}
          <a href={GH} target="_blank" rel="noopener">
            GitHub
          </a>
          . Or ping{" "}
          <a href="https://x.com/distroinfinity" target="_blank" rel="noopener">
            @distroinfinity
          </a>{" "}
          on X. A human reads all three.
        </p>
      </section>

      <p className="how-foot">Last updated: 5 June 2026.</p>

      <a className="how-back" href="/">
        ← back to the board
      </a>
    </div>
  );
}
