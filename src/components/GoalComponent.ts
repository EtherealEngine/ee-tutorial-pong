import { Entity } from '@etherealengine/engine/src/ecs/classes/Entity'
import { defineComponent } from '@etherealengine/engine/src/ecs/functions/ComponentFunctions'
export const GoalComponent = defineComponent({
  name: 'Goal Component',
  jsonID: 'pong.goal',
  onInit: (entity) => {
    return {
      collider: 0 as Entity,
      paddle: 0 as Entity,
      text: 0 as Entity,
      avatar: 0 as Entity,
      damage: 9,
    }
  },
  onSet: (entity, component, json) => {
  },
  toJSON: (entity, component) => {
    return {}
  }
})