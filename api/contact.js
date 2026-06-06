import { Resend } from 'resend';
let _resend = null;
const getResend = () => { if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY); return _resend; };

export default async (req, res) => {
    const resend = getResend();

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
        name = '',
        email = '',
        subject = '',
        message = '',
        source = 'landing'
    } = req.body || {};

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedSubject = String(subject).trim();
    const normalizedMessage = String(message).trim();
    const normalizedName = String(name).trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ error: 'invalid_email' });
    }

    if (!normalizedMessage || normalizedMessage.length < 5 || normalizedMessage.length > 5000) {
        return res.status(400).json({ error: 'invalid_message' });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'SITT <noreply@sitt.space>';
    const toEmail = process.env.CONTACT_TO_EMAIL || 'rouffdesign@gmail.com';

    try {
        await resend.emails.send({
            from: fromEmail,
            to: toEmail,
            reply_to: normalizedEmail,
            subject: normalizedSubject || 'New SITT contact message',
            text:
                `Source: ${source}
Name: ${normalizedName || 'N/A'}
Email: ${normalizedEmail}

Subject: ${normalizedSubject || '(none)'}

Message:
${normalizedMessage}`,
        });

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('CONTACT_SEND_ERROR', err);
        return res.status(502).json({ error: 'email_send_failed' });
    }
};
