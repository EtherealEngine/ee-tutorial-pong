
import { getState } from '@etherealengine/hyperflux'
import { EngineState } from '@etherealengine/engine/src/ecs/classes/EngineState'
import { isClient } from '@etherealengine/engine/src/common/functions/getEnvironment'

import './components/TextComponent'
import './components/BallComponent'
import './components/PaddleComponent'
import './components/PlateComponent'
import './components/GoalComponent'
import './components/PongComponent'

import './systems/PongSystem'

export default async function worldInjection() {
  console.log("********************** pong doing world injection ******************** ")
  if (isClient && getState(EngineState).isEditor) {
    await import("./clientInjection.js")
  }
}
