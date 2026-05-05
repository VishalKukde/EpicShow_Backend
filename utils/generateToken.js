import jwt from "jsonwebtoken";

export const generateAccessToken = (user, expiresIn="15m" ) => {
    const userId = user?._id || user?.id || user;
    const tokenVersion = Number(user?.tokenVersion ?? 0);
    return jwt.sign(
        { id: userId, tokenVersion , type: "access"},
        process.env.JWT_SECRET,
        { expiresIn: expiresIn }
    )
}

// to generate the JWT Screat Key :
// node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"


export const generateRefreshToken = (user, expiresIn = "7d") => {
  const userId = user?._id || user?.id || user;
  const tokenVersion = Number(user?.tokenVersion ?? 0);
  return jwt.sign(
    { id: userId, tokenVersion, type: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn }
  )
}
