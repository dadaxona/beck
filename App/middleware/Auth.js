const jwt = require('jsonwebtoken');

const SECRET_KEY = 'abcde1234567890abcde1234567890';
const expiresIn = '1d';
const algorithm = 'HS256';
const issuer = 'node-no-code-aplication-servis-key';
const audience = 'node-no-code-aplication-clientkey';

function generateToken(payload) {
    return jwt.sign(payload, SECRET_KEY, {
        algorithm: algorithm,
        expiresIn: expiresIn,
        issuer: issuer,
        audience: audience
    });
}
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Invalid authorization header' });
    }
    const token = authHeader.slice('Bearer '.length);
    if (!token) {
        return res.status(401).json({ success: false, message: 'Token missing' });
    }
    try {
        const decoded = jwt.verify(token, SECRET_KEY, {
            algorithms: [algorithm],
            issuer: issuer,
            audience: audience,
            expiresIn: expiresIn,
            algorithm: algorithm
        });
        if (decoded) {
            req.user = decoded;
            next();
        } else {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
}
module.exports = {
    generateToken,
    verifyToken
};