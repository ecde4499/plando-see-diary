'use strict';

// Cookie-based state-changing requests must come from this application.
function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  let parsed;
  try { parsed = new URL(origin); } catch {
    return res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.' });
  }
  const configured = process.env.PUBLIC_ORIGIN;
  if (configured) {
    let trusted;
    try { trusted = new URL(configured).origin; } catch {
      return res.status(500).json({ error: '서버 출처 설정을 확인하세요.' });
    }
    if (parsed.origin !== trusted) {
      return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
    }
  } else if (parsed.host !== req.get('host') ||
      (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:')) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }
  next();
}

module.exports = { requireSameOrigin };
