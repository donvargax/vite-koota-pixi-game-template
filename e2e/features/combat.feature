@combat @realtime
Feature: Ranged combat
  Scenario: Defeating an enemy by shooting
    Given I have entered a fresh arena
    When I fire right at the approaching enemies
    Then fewer enemies remain in the arena
