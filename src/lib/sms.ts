// OTP delivery providers. Configure OTP_PROVIDER = console | msg91 | twilio
export async function sendOtpSms(mobile: string, code: string): Promise<void> {
  const provider = process.env.OTP_PROVIDER ?? "console";
  const msg = `${code} is your Enversys login OTP. Valid for 5 minutes. Do not share it with anyone.`;
  if (provider === "msg91") {
    const r = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: process.env.MSG91_AUTH_KEY ?? "" },
      body: JSON.stringify({ template_id: process.env.MSG91_TEMPLATE_ID, mobile: `91${mobile}`, otp: code }),
    });
    if (!r.ok) throw new Error(`MSG91 error ${r.status}`);
    return;
  }
  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID!, tok = process.env.TWILIO_AUTH_TOKEN!;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: `+91${mobile}`, From: process.env.TWILIO_FROM ?? "", Body: msg }),
    });
    if (!r.ok) throw new Error(`Twilio error ${r.status}`);
    return;
  }
  console.log(`[OTP] ${mobile}: ${code}`);
}
