/**
 * Owner-approved ownership line. The wording is contractual: keep it byte-exact,
 * including the contact address, and render it once per page.
 */
export const OWNERSHIP_FOOTER_TEXT =
  "© 2026 Grandmaster Academy | Founder - Chunian, Punjab, Pakistan | Contact: businesskids62@gmail.com | Built by Grandmaster Digital Hub";

const footerStyle = {
  display: "block",
  margin: "12px 0 0",
  fontSize: "12px",
  lineHeight: 1.7,
  textAlign: "inherit",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  hyphens: "auto",
};

export default function OwnershipFooter() {
  return (
    <p className="gm-ownership-footer" style={footerStyle}>
      {OWNERSHIP_FOOTER_TEXT}
    </p>
  );
}
