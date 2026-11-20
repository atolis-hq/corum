import React from 'react'
import htm from 'htm'

/* htm bound to React.createElement: the tagged template used for all SDK markup. */
export const html = htm.bind(React.createElement)
