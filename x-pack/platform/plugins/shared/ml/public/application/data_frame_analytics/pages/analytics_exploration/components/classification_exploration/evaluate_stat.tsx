/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FC } from 'react';
import React from 'react';
import { EuiStat, EuiIconTip, EuiFlexGroup, EuiFlexItem, useEuiTheme } from '@elastic/eui';
import { EMPTY_STAT } from '../../../../common/analytics';

interface Props {
  isLoading: boolean;
  title: number | null;
  description: string;
  dataTestSubj: string;
  tooltipContent: string;
}

export const EvaluateStat: FC<Props> = ({
  isLoading,
  title,
  description,
  dataTestSubj,
  tooltipContent,
}) => {
  const {
    euiTheme: { size },
  } = useEuiTheme();

  return (
    <EuiFlexGroup gutterSize="xs" data-test-subj={dataTestSubj} alignItems="flexEnd">
      <EuiFlexItem grow={false}>
        <EuiStat
          reverse
          isLoading={isLoading}
          title={title !== null ? Math.round(title * 1000) / 1000 : EMPTY_STAT}
          description={description}
          titleSize="xs"
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false} css={{ paddingBottom: `${size.xxs}` }}>
        <EuiIconTip content={tooltipContent} />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};
