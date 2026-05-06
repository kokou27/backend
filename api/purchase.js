export default async (req, res) => {
    return res.status(410).json({
        error: 'Gone',
        message: 'Cet endpoint est deprecie. Utilisez /api/webhook.'
    });
};
