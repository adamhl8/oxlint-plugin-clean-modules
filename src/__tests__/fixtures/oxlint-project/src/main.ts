import { value } from './helper'

const lazyHelper = import("./helper")

console.log(value, lazyHelper)
