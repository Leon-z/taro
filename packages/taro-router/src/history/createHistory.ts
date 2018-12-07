import warning from 'warning';
import Taro from '@tarojs/taro-h5';

import { Action, History, HistoryState, Location } from '../utils/types';
import createTransitionManager from './createTransitionManager';
import { createLocation } from './LocationUtils';
import { addLeadingSlash, createPath, hasBasename, stripBasename, stripTrailingSlash } from './PathUtils';

const PopStateEvent = 'popstate'
const defaultStoreKey = 'taroRouterStore'

const globalHistory = window.history

const getHashPath = (): string => {
  const href = window.location.href
  const hashIndex = href.indexOf('#')
  return hashIndex === -1 ? '' : href.substring(hashIndex + 1)
}

let stateKey = 0

/**
 * 获取state key
 */
const createKey = () => String(++stateKey)

const getHistoryState = () => {
  try {
    const state = globalHistory.state || {}
    if (typeof state.key !== 'string') {
      state.key = String(stateKey)
    } else {
      stateKey = state.key
    }
    return state
  } catch (e) {
    // IE 11 sometimes throws when accessing window.history.state
    // See https://github.com/ReactTraining/history/pull/289
    return {
      key: String(stateKey)
    }
  }
}

const tryToParseStore = (state: HistoryState) => {
  let store: HistoryState = { key: '0' }
  try {
    const storeObj = JSON.parse(localStorage.getItem(defaultStoreKey)!)
    if (typeof storeObj === 'object' && typeof storeObj.key === 'string') {
      store = storeObj
    }
  } catch (e) {}

  const isValid = store.key === state.key

  warning(isValid, 'Invalid location store, it is rewrote')

  if (!isValid) {
    store.key = state.key!
  }

  return store
}

/**
 * 创建对象序列化的函数
 *
 * @param storeObj 需要序列化的对象引用
 */
const createHistorySerializer = (storeObj: HistoryState) => {
  let serialize = () => {
    localStorage.setItem(defaultStoreKey, JSON.stringify(storeObj))
  }
  serialize()
  return serialize
}

const createHistory = (props: { basename?: string, mode: "hash" | "browser" } = { mode: "hash" }) => {
  const transitionManager = createTransitionManager()
  const basename = props.basename ? stripTrailingSlash(addLeadingSlash(props.basename)) : ''
  let listenerCount = 0
  let serialize

  const getDOMLocation = (historyState: HistoryState): Location => {
    const { key } = historyState
    const { pathname, search, hash } = window.location
    let path = props.mode === "hash"
      ? addLeadingSlash(getHashPath())
      : pathname + search + hash;

    warning(!basename || hasBasename(path, basename), 'You are attempting to use a basename on a page whose URL path does not begin ' + 'with the basename. Expected path "' + path + '" to begin with "' + basename + '".')

    if (basename) path = stripBasename(path, basename)

    return createLocation(path, key)
  }

  const initState = getHistoryState()

  const initialLocation = getDOMLocation(initState)
  let lastLocation = initialLocation

  let store = tryToParseStore(initState)

  serialize = createHistorySerializer(store)

  globalHistory.replaceState(initialLocation.state, '')

  const createHref = props.mode === "hash"
    ? location => '#' + addLeadingSlash(basename + createPath(location))
    : location => basename + createPath(location)

  const setState = (nextState: { action: 'POP' | 'PUSH' | 'REPLACE'; location: Location }): void => {
    Object.assign(history, nextState)

    const fromLocation = {...lastLocation}

    // 记录最后一个location，浏览器前进后退按钮用
    lastLocation = {...nextState.location}

    stateKey = Number(nextState.location.state!.key)

    serialize()

    history.length = globalHistory.length
    const params = {
      fromLocation,
      toLocation: history.location,
      action: history.action
    }

    Taro['eventCenter'].trigger('routerChange', {...params})
    transitionManager.notifyListeners({...params})
  }

  const push = (path: string) => {
    const action = 'PUSH'
    const key = createKey()
    const location = createLocation(path, key, history.location)

    const href = createHref(location)

    globalHistory.pushState({ key }, '', href)

    store.key = key!

    setState({ action, location })
  }

  const replace = (path: string | Location) => {
    const action = 'REPLACE'
    const key = store.key
    const location = createLocation(path as string, key, history.location)

    const href = createHref(location)

    globalHistory.replaceState({ key }, '', href)

    setState({ action, location })
  }

  const go = (num: number) => {
    globalHistory.go(num)
  }

  const goBack = () => go(-1)
  const goForward = () => go(1)

  const handlePopState: WindowEventHandlers['onpopstate'] = (e: { state: HistoryState }) => {
    // history.pushState和history.replaceState不会触发这个事件
    // 仅在浏览器前进后退操作、history.go/back/forward调用、hashchange的时候触发
    // 这里的window.location已经是新的了

    let state = e.state
    if (!state) {
      state = {
        key: createKey()
      }
      globalHistory.replaceState(state, '', '')
    }
    const currentKey = Number(lastLocation.state.key)
    const nextKey = Number(state.key)
    const nextLocation = getDOMLocation(state)
    let action: Action
    if (nextKey > currentKey) {
      action = 'PUSH'
    } else if (nextKey < currentKey) {
      action = 'POP'
    } else {
      action = 'REPLACE'
    }

    store.key = String(nextKey)
    setState({ action, location: nextLocation })
  }

  const checkDOMListeners = delta => {
    listenerCount += delta

    if (listenerCount === 1) {
      window.addEventListener(PopStateEvent, handlePopState)
    } else if (listenerCount === 0) {
      window.removeEventListener(PopStateEvent, handlePopState)
    }
  }

  const listen = listener => {
    const unlisten = transitionManager.appendListener(listener)
    checkDOMListeners(1)

    return () => {
      checkDOMListeners(-1)
      unlisten()
    }
  }

  let isBlocked = false

  const block = (prompt = false) => {
    const unblock = transitionManager.setPrompt(prompt)

    if (!isBlocked) {
      checkDOMListeners(1)
      isBlocked = true
    }

    return () => {
      if (isBlocked) {
        isBlocked = false
        checkDOMListeners(-1)
      }

      return unblock()
    }
  }

  const history: History = {
    action: 'POP',
    block,
    createHref,
    go,
    goBack,
    goForward,
    length: globalHistory.length,
    listen,
    location: initialLocation,
    push,
    replace
  }

  return history
}

export default createHistory