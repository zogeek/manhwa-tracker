import { hc } from "hono/client";
import {AppType } from "../../../api/src/index"

const api = hc<AppType>('http://localhost:3001')

export default api 